import {
  ClusterMachine,
  LocalClient,
  Logger
} from 'clustd-lib';
import { EventEmitter } from 'events';
import { Config } from './config';
import * as assert from 'assert';

export class Cluster extends EventEmitter {

  private readonly logger = new Logger('cluster');
  private readonly machines: { [id: string]: ClusterMachine } = {};
  readonly local: ClusterMachine;
  master?: ClusterMachine;

  constructor(localClient: LocalClient) {
    super();
    this.local = new ClusterMachine(localClient, localClient.remoteAddress);
    assert(this.local.local, 'local machine not considered local');
  }

  register(machine: ClusterMachine, prevId?: string): boolean {
    assert(machine.id, 'machine missing id');
    assert(machine.active, 'machine must be active');
    if (prevId) {
      const old = this.machines[prevId];
      if (old) {
        old.stop();
        delete this.machines[prevId];
      }
    }
    if (this.machines[machine.id!]) {
      const old = this.machines[machine.id!];
      if (old.local) {
        return false;
      }
      if (old.open) {
        machine.stop();
        this.logger.info(`Keeping previous machine '${machine.id}' connection alive`);
        return false;
      } else {
        this.logger.info(`Disconnected machine '${machine.id}' has reconnected`);
        old.stop();
      }
    }
    this.machines[machine.id!] = machine;
    this.logger.info(`Registered machine '${machine.id}'`);
    return true;
  }

  async joinAll() {
    for (const host of Config.cluster.machines) {
      const machine = new ClusterMachine(this.local.localClient, host);
      assert(this.local.host !== host, 'remote machine must not be local');
      this.setupMachineListeners(machine);
      machine.start();
      try {
        await machine.scheduleConnection(0, true);
      } catch (e) {
        this.logger.warn('Failed to join cluster:', machine.host);
      }
    }
  }

  setupMachineListeners(machine: ClusterMachine) {
    machine.once('open', () => {
      if (!this.register(machine)) {
        machine.stop();
      }
    });

    machine.on('close', () => {
      if (this.master!.id === machine.id) {
        this.assignMaster();
      }
    });

    machine.on('cluster_master_get', () => {
      machine.emit('cluster_master_current', this.master!.id);
    });
  }

  async getRemoteMaster(): Promise<ClusterMachine|undefined> {
    if (!Object.keys(this.machines).length) {
      return;
    }

    let master: ClusterMachine|undefined;
    for (const m of Object.values(this.machines)) {
      const newMasterId: string = (await m.send('get_master')).master;
      const newMaster = this.machines[newMasterId];
      if (!newMaster) {
        this.logger.warn('Unrecognized machine id:', newMasterId);
        continue;
      }
      if (!(master === undefined || newMaster.id === master.id)) {
        throw new Error('fatal master mismatch on the network');
      }
      master = newMaster;
    }
    return master;
  }

  assignMaster(newMasterId?: string) {
    let newMaster: ClusterMachine;
    if (newMasterId) {
      newMaster = this.machines[newMasterId];
      assert(newMaster, 'new forced master must be registered');
    } else {
      const sorted: ClusterMachine[] = [
        this.local,
        ...Object.values(this.machines)
      ].filter(m => m.active && m.open).sort((a, b) => {
        return a.id! < b.id! ? -1 : 1;
      });
      newMaster = sorted[0];
    }
    if (this.master) {
      this.master.master = false;
    }
    this.master = newMaster;
    this.master.master = true;
    this.logger.info('Assigned cluster master:', this.master.id);

    const isMaster = this.master.id === this.local.id;
    this.emit('assign_master', this.master.id, isMaster);
  }
}
