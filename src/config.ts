import * as assert from 'assert';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

export interface ServerConfig {
  bind_address: string;
  bind_port: number;
  remote_address: string;
}

export interface ClusterConfig {
  secret: string;
  id: string;
  machines: string[];
}

export interface Config {
  server: ServerConfig;
  cluster: ClusterConfig;
}

export const Config: Config = {} as any;
if (process.env.NODE_ENV !== 'TEST') {
  const file = process.env.CLUSTD_CONFIG || 'config.yml';
  const data = fs.readFileSync(file).toString('utf8');
  const raw = yaml.safeLoad(data);
  setConfig(raw);
}

export function setConfig(conf: Config) {
  Object.assign(Config, conf);
  validate();
}

function validate() {
  assert(Config.server, 'missing server config');
  assert(Config.server.bind_address, 'missing server.bind_address config');
  assert(Config.server.bind_port, 'missing server.bind_port config');
  assert(Config.server.remote_address, 'missing server.remote_address config');

  assert(Config.cluster, 'missing cluster config');
  assert(Config.cluster.secret, 'missing cluster.secret config');
  assert(Config.cluster.id, 'missing cluster.id config');
  assert(Config.cluster.machines, 'missing cluster.machine config');
}
