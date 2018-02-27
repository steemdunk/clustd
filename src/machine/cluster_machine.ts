import { GenericMachine } from './generic_machine';
import { EventEmitter } from 'events';
import * as assert from 'assert';

export class ClusterMachine extends GenericMachine {

  readonly type = 'cluster';
  master: boolean = false;

  constructor(host?: string) {
    super(host);
  }

  start(): void {
    super.start();
  }

  async onRequest(method: string, params?: any[]): Promise<any> {
    switch (method) {
      case 'get_master':
        let masterId: string|undefined;
        this.once('cluster_master_current', id => {
          masterId = id;
        });
        this.emit('cluster_master_get');
        assert(masterId, 'master ID must be present');
        return {
          master: masterId
        };
    }
    return undefined;
  }
}
