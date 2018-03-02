import { RemoteDriver } from './driver';
import { Logger } from 'clustd-lib';
import { Cluster } from './cluster';
import * as assert from 'assert';

export class DriverManager {

  private readonly logger = new Logger('driver_manager');
  private readonly drivers: RemoteDriver[] = [];
  private isMaster = false;

  init(cluster: Cluster) {
    cluster.on('assign_master', async (id: string, isMaster: boolean) => {
      const changed = (this.isMaster && !isMaster) || (!this.isMaster && isMaster);
      this.isMaster = isMaster;
      if (changed) {
        for (const driver of Object.values(this.drivers)) {
          try {
            await driver.trigger(isMaster);
          } catch (e) {
            this.logger.error('Failed to trigger driver', driver.id, e);
            driver.stop();
          }
        }
      }
    });
  }

  register(driver: RemoteDriver) {
    assert(driver.open, 'driver must be open');
    assert(driver.id, 'driver must be initialized');
    this.drivers[driver.id!] = driver;
    driver.on('close', () => {
      driver.stop();
      delete this.drivers[driver.id!];
    });

    driver.trigger(this.isMaster);
  }
}
