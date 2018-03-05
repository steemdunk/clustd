# Clustd

Clustd is a cluster provider and daemon control service. The goal of this project is to provide fully automated fail over for apps and standard servers.

This is not intended to be used in conjunction with a database, otherwise data will be out of sync. See your database manual for setting up clusters that will preserve the integrity of your database across multiple machines.

## Configuration

A cluster must provide a secret to communicate and must be the same on each machine. For extra security it is recommended to restrict incoming connections to the bind port from designated cluster machines.

The remote address must represent the full URI of the current machine. This is for outbound cluster machines that want to connect back to the originating inbound server.

The id must be unique across all machines in the cluster. Having machines with the same id can result in undefined behavior.

The machines array must contain a list of all remote cluster machines. The daemon will attempt to connect to each machine and determine the cluster master based on the information. All machine configurations must be consistently configured to each.

```yml
server:
  bind_address: 0.0.0.0
  bind_port: 3001
  remote_address: ws://127.0.0.1:3001
cluster:
  secret: 'vxLjIO8pOjvcA48RlXWCy8D/RIr/2S0y/gF1ncypHDjM9oINXfRkUW2wN/tKmjYF'
  id: cm-1
  machines:
    - ws://127.0.0.1:3002
    - ws://127.0.0.1:3003
```

### Generating a random secret

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## Drivers

Drivers will be managing what happens when a cluster becomes a master or a backup. For example, if a machine goes down, another machine that becomes the master can start a service and automatically update any server configuration for public consumption, minimizing downtime.

Check out the library at https://github.com/steemdunk/clustd-lib for writing your own drivers.
