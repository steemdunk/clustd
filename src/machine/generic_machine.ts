import { EventEmitter } from 'events';
import { Logger } from '../logger';
import { Client } from '../client';
import { Config } from '../config';
import * as newDebug from 'debug';
import * as assert from 'assert';
import * as WebSocket from 'ws';

const debug = newDebug('clustd:machine');
let globalId = 0;

interface Request {
  resolve: (data) => void;
  reject: (err) => void;
}

export abstract class GenericMachine extends EventEmitter {

  abstract type: string;
  host: string;

  protected readonly logger = new Logger('machine', (msg) => {
    return `[${this.id ? this.id : this.host} (${this.globalId})] ${msg}`;
  });

  protected client?: Client;
  private globalId: number = globalId++;
  private _id?: string;
  private _active: boolean;
  private reqId: number = 0;
  private reqs: { [id: string]: Request } = {};

  private connectionTimer!: NodeJS.Timer;
  private pingTimer!: NodeJS.Timer;
  private lastPong: number = 0;

  get active() { return this._active; }
  get open() {
    return this.local || (this.active && this.client && this.client.open);
  }

  get id() { return this._id; }
  get local() { return this.host === Config.server.remote_address; }

  constructor(host?: string) {
    super();
    this.host = host!;
    this._active = this.local;
    if (this.local) {
      this._id = Config.cluster.id;
      this.logger.info('Initialized local machine');
    }
  }

  abstract onRequest(method: string, params?: any[]): Promise<any>;

  start(): void {
    if (this.active || this.local) return;
    this._active = true;
    this.schedulePing();
  }

  stop() {
    if (this.local) return;
    this._active = false;
    if (this.client) {
      this.client.removeAllListeners();
      this.client.close();
      this.client = undefined;
    }
    this.removeAllListeners();
    clearTimeout(this.connectionTimer);
    clearTimeout(this.pingTimer);
    this.lastPong = 0;
    for (const key of Object.keys(this.reqs)) {
      const req = this.reqs[key];
      delete this.reqs[key];
      req.reject(new Error('stopped'));
    }
  }

  setClient(client: Client): boolean {
    assert(!this.local, 'cannot set client on a local machine');
    assert(this.active, 'machine must be considered active');
    assert(this.id, 'machine missing id');
    assert(this.host, 'machine missing host');
    if (this.client && this.client.open) return false;
    this.client = client;

    this.client.on('ping', () => {
      this.lastPong = Date.now();
      debug('[%s] Received ping request', this.id);
    });

    this.client.on('pong', () => {
      this.lastPong = Date.now();
      debug('[%s] Received pong response', this.id);
    });

    return true;
  }

  async send(method: string, params?: any[]) {
    if (!this.open) {
      throw new Error('disconnected');
    }
    const id = this.reqId++;
    return new Promise<any>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        request.reject(new Error('timed out'));
      }, 3000);

      const request: Request = {
        resolve: data => {
          delete this.reqs[id];
          clearTimeout(timer);
          resolve(data);
        },
        reject: error => {
          delete this.reqs[id];
          clearTimeout(timer);
          reject(error);
        }
      };

      try {
        this.reqs[id] = request;
        await this.client!.sendMessage({
          req_id: id,
          method,
          params
        });
      } catch (e) {
        request.reject(e);
      }
    });
  }

  async initClient(client: Client) {
    client.on('handshake_verify', data => {
      try {
        // TODO allow ID renaming
        if (this._id)
          assert(data.id === this._id, `id mismatch: ${this._id} -> ${data.id}`);
        this._id = data.id;
        this.host = data.remote_address;
        assert(this._id, 'handshake missing id');
        assert(this.host, 'handshake missing remote address');
        if (this.setClient(client)) {
          this.logger.info('Successfully connected');
          client.emit('handshake_complete');
        } else {
          throw new Error('failed to set client');
        }
      } catch (e) {
        this.logger.error('Handshake failed:', e.message);
        client.removeAllListeners();
        client.close();
        this.client = undefined;
      }
    });

    client.on('message', async msg => {
      if (msg.req_id !== undefined) {
        const id = msg.req_id;
        const method = msg.method;
        const params = msg.params;
        try {
          const resp = await this.onRequest(method, params);
          if (resp) {
            await this.client!.sendMessage({
              res_id: id,
              data: resp
            });
          } else {
            await this.client!.sendMessage({
              res_id: id,
              error: 'unrecognized method for this machine'
            });
          }
        } catch (e) {
          this.logger.error('Failed to process message', e);
          this.client!.sendMessage({
            res_id: id,
            error: 'failed to process message'
          }).catch(e => {
            this.logger.error('Failed to send response:', e);
          });
        }
      } else if (msg.res_id !== undefined) {
        const req = this.reqs[msg.res_id];
        if (req) {
          delete this.reqs[msg.res_id];
          req.resolve(msg.data);
        }
      } else {
        this.logger.warn('Message dropped: ', msg);
      }
    });

    client.on('close', () => {
      if (this.client) {
        this.logger.warn('Connection lost');
        this.client = undefined;
        this.emit('close');
        this.scheduleConnection();
      }
    });

    await client.init();
  }

  private schedulePing(time = 1500) {
    assert(!this.local, 'only remote machines can schedule connections');
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (!this.active) {
        clearInterval(this.pingTimer);
        return;
      }

      if (this.client) {
        if (this.client.open) {
          debug('[%s] Sent ping request', this.id);
          const delta = Date.now() - this.lastPong;
          if (this.lastPong !== 0 && delta > (time * 2)) {
            debug('[%s] Pong delta is too great, closing connection', this.id);
            this.client.close();
            return;
          }
          this.client.ping();
        } else {
          this.logger.warn('Attempting to ping a closed machine');
        }
      }
    }, time);
  }

  scheduleConnection(time = 5000, rejectOnFail = false): Promise<any> {
    assert(!this.local, 'only remote machines can schedule connections');
    let resolve: () => void;
    let reject: (err) => void;
    const prom: Promise<any> = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.connectionTimer = setTimeout(async () => {
      try {
        if (!this.active || this.open) {
          return;
        }
        const client = new Client(false);
        const meta = Buffer.from(client.encryptMsg({
          type: this.type
        }).buffer as ArrayBuffer);
        client.setSocket(new WebSocket(this.host, {
          headers: {
            'metadata': meta.toString('base64')
          }
        }));
        await this.initClient(client);
        resolve();
        this.emit('open');
      } catch (e) {
        const err = 'Failed to connect to host: ' + e.message;
        this.logger.error(err);
        this.scheduleConnection();
        if (rejectOnFail) reject(new Error(err));
        else resolve();
      }
    }, time);
    return prom;
  }
}
