import { GenericMachine, ClusterMachine } from './machine';
import { Cluster } from './cluster';
import { Config } from './config';
import { Client } from './client';
import { Logger } from './logger';
import * as newDebug from 'debug';
import * as WebSocket from 'ws';

const debug = newDebug('clustd:main');
const logger = new Logger('clustd');
const cluster = new Cluster(Config.server.remote_address);

(async () => {
  await cluster.joinAll();
  const master = await cluster.getRemoteMaster();
  if (!master) {
    logger.info('Starting a new cluster...');
    cluster.assignMaster();
  } else {
    cluster.assignMaster(master.id);
  }

  const ws = new WebSocket.Server({
    host: Config.server.bind_address,
    port: Config.server.bind_port,
    maxPayload: 1024 * 1024
  });

  ws.on('listening', async () => {
    const addr = Config.server.bind_address;
    const port = Config.server.bind_port;
    logger.info(`Cluster server bound to ${addr}:${port}`);
  });

  ws.on('connection', async (socket, req) => {
    const addr = req.socket.remoteAddress;
    try {
      const client = new Client(true, socket);
      const header = Buffer.from(req.headers['metadata'] as string, 'base64');
      const meta = client.decryptMsg(header);
      debug('Incoming client (%s) presents metadata: %o', addr, meta);
      if (meta.type === 'cluster') {
        const machine = new ClusterMachine();
        cluster.setupMachineListeners(machine);
        machine.start();
        await machine.initClient(client);
        if (!cluster.register(machine)) {
          machine.stop();
        }
      } else {
        throw new Error('unknown type: ' + meta.type);
      }
    } catch (e) {
      socket.close();
      logger.warn(`Failed to initialize incoming client (${addr})`, e ? e : '');
    }
  });
})();