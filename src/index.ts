import {
  HandshakeRejected,
  HsRejectStatus,
  GenericMachine,
  ClusterMachine,
  LocalClient,
  Client,
  Logger,
} from 'clustd-lib';
import { RemoteDriver } from './driver';
import { DriverManager } from './driver_manager';
import { Cluster } from './cluster';
import { Config } from './config';
import * as newDebug from 'debug';
import * as WebSocket from 'ws';

const debug = newDebug('clustd:main');
const logger = new Logger('clustd');
const localClient: LocalClient = {
  secret: Config.cluster.secret,
  remoteAddress: Config.server.remote_address,
  id: Config.cluster.id
};

const cluster = new Cluster(localClient);
const driverManager = new DriverManager();
driverManager.init(cluster);

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
      const client = new Client(localClient, true, socket);
      const header = Buffer.from(req.headers['metadata'] as string, 'base64');
      const meta = client.decryptMsg(header);
      debug('Incoming client (%s) presents metadata: %o', addr, meta);
      if (meta.type === 'cluster') {
        await handleClusterConn(client);
      } else if (meta.type === 'driver') {
        await handleDriverConn(client, addr!);
      } else {
        throw new Error('unknown type: ' + meta.type);
      }
    } catch (e) {
      socket.close();
      logger.warn(`Failed to initialize incoming client (${addr})`, e ? e : '');
    }
  });
})();

async function handleClusterConn(client: Client) {
  const machine = new ClusterMachine(localClient);
  cluster.setupMachineListeners(machine);
  machine.start();
  try {
    await machine.initClient(client);
    if (!cluster.register(machine)) {
      machine.stop();
      return;
    }

    const newMasterId: string = (await machine.send('get_master')).master;
    if (newMasterId && newMasterId === machine.id) {
      // when newMasterId isn't present it's a new cluster instance
      cluster.assignMaster(newMasterId);
    }
  } catch (e) {
    if (!(e instanceof HandshakeRejected
          && e.type === HsRejectStatus.REJECTED)) {
      throw e;
    }
  }
}

async function handleDriverConn(client: Client, addr: string) {
  const machine = new RemoteDriver(localClient, addr);
  machine.start();
  machine.once('should_accept_handshake', () => {
    machine.emit('handshake_accept', true);
  });
  await machine.initClient(client, true);
  driverManager.register(machine);
}
