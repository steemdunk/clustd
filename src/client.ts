import { EventEmitter } from 'events';
import { Logger } from './logger';
import * as newDebug from 'debug';
import { Config } from './config';
import * as crypto from 'crypto';
import * as assert from 'assert';
import * as WebSocket from 'ws';

const debug = newDebug('clustd:client');

const SECRET = String(Config.cluster.secret);
const SECRET_LEN = Buffer.byteLength(SECRET, 'utf8');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export class Client extends EventEmitter {

  private readonly logger = new Logger('client');

  readonly serverSocket: boolean;
  private socket!: WebSocket;
  private ticket!: number;

  private incomingCtr: number = 0;
  private outgoingCtr: number = 0;
  private initialized = false;

  get open() { return this.socket.readyState === WebSocket.OPEN; }

  constructor(serverSocket: boolean, socket?: WebSocket) {
    super();
    this.serverSocket = serverSocket;
    this.socket = socket!;
  }

  async init() {
    await this.listen();
    if (this.serverSocket) {
      this.ticket = crypto.randomBytes(4).readUInt32BE(0);
      await this.sendHello();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.initialized) {
          return reject(new Error('client handshake failed'));
        }
        resolve();
      }, 5000);
      this.once('handshake_complete', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  close(): void {
    if (this.open) {
      this.socket.close();
    }
  }

  ping(): void {
    if (this.open) {
      this.socket.ping();
    }
  }

  setSocket(ws: WebSocket): void {
    assert(!this.socket, 'socket must be initially undefined');
    this.socket = ws;
  }

  private async listen(): Promise<void> {
    this.socket.on('message', async encryptedData => {
      try {
        const data = this.decryptMsg(encryptedData as Buffer);
        debug('Received data: %o', data);
        if (data.hello_world) {
          if (this.initialized) {
            this.close();
            this.logger.error('Socket handshake already initialized');
            return;
          }
          this.ticket = data.hello_world;
          if (!this.serverSocket) await this.sendHello();
          this.once('handshake_complete', async () => {
            this.initialized = true;
            debug('Handshake completed');
          });
          this.emit('handshake_verify', data);
        } else if (!data.hello_world) {
          if (!this.initialized) {
            this.close();
            this.logger.error('Receiving a message before handshake is complete');
          }
          this.emit('message', data);
        }
      } catch (e) {
        this.logger.error('Failed to process message', e);
      }
    });

    this.socket.on('ping', data => {
      this.emit('ping', data);
    });

    this.socket.on('pong', data => {
      this.emit('pong', data);
    });

    this.socket.on('close', () => {
      this.emit('close');
      this.removeAllListeners();
      this.socket.removeAllListeners();
    });

    this.socket.on('error', (err: any) => {
      if (err.code !== 'ECONNREFUSED') {
        this.logger.error('Unknown client socket error', err);
      }
    });

    if (!this.serverSocket) {
      return new Promise<void>((resolve, reject) => {
        const removeListeners = () => {
          this.socket.removeListener('open', res);
          this.socket.removeListener('error', rej);
          this.socket.removeListener('close', rej);
        }

        const res = () => {
          removeListeners();
          resolve();
        }

        const rej = (err?: any) => {
          removeListeners();
          reject(err);
        }

        this.socket.once('open', res);
        this.socket.once('error', rej);
        this.socket.once('close', rej);
      });
    }
  }

  async sendMessage(data: any, force?: boolean) {
    return new Promise((resolve, reject) => {
      if (!(this.initialized || force)) {
        return reject(new Error('connection not initialized'));
      } else if (!this.open) {
        return reject(new Error('connection closed'));
      }

      try {
        const enc = this.encryptMsg(data);
        this.socket.send(enc, err => {
          debug('Sent message: %o', data);
          !err ? resolve() : reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  private async sendHello() {
    await this.sendMessage({
      hello_world: this.ticket,
      id: Config.cluster.id,
      remote_address: Config.server.remote_address
    }, true);
  }

  encryptMsg(data: any): Uint8Array {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this.getKey(++this.outgoingCtr);
    const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
    const enc = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    const length = IV_LENGTH + TAG_LENGTH + enc.length;
    return new Uint8Array(Buffer.concat([iv, tag, enc], length));
  }

  decryptMsg(buf: Buffer): any {
    let final!: Buffer;
    try {
      const iv = Buffer.from(buf).slice(0, IV_LENGTH);
      const tag = buf.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const rawData = buf.slice(IV_LENGTH + TAG_LENGTH);
      const key = this.getKey(++this.incomingCtr);

      const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
      decipher.setAuthTag(tag);
      final = Buffer.concat([
        decipher.update(rawData),
        decipher.final()
      ]);
    } catch (e) {
      this.close();
      debug('Failed to decrypt message %o', e);
      assert(false, 'message decryption failure, verify the cluster secret');
    }
    return JSON.parse(final.toString('utf8'));
  }

  private getKey(nonce: number): Buffer {
    const secret = Buffer.allocUnsafe(SECRET_LEN + (this.initialized ? 8 : 4));
    secret.write(SECRET, 0, SECRET_LEN, 'utf8');
    secret.writeUInt32BE(nonce, SECRET_LEN);
    if (this.initialized) secret.writeUInt32BE(this.ticket, SECRET_LEN + 4);

    const hasher = crypto.createHash('sha256');
    return hasher.update(secret).digest().slice(0, 16);
  }
}
