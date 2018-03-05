import { DriverMachine, LocalClient } from 'clustd-lib';

export class RemoteDriver extends DriverMachine {

  constructor(localClient: LocalClient, host: string) {
    super(localClient, host, false);
  }

  async trigger(isMaster: boolean) {
    try {
      await this.send('trigger', {
        isMaster
      });
    } catch (e) {
      throw e;
    }
  }
}
