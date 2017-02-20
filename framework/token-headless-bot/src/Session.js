const Config = require('./Config');
const fs = require('fs');
const mkdirp = require('mkdirp');
const pg = require('pg');
const url = require('url')

class Session {
  constructor(bot, address, onReady) {
    this.bot = bot;
    this.config = new Config(process.argv[2]);

    let params = url.parse(this.config.postgres.url);
    let auth = params.auth.split(':');
    let pgConfig = {
      user: auth[0],
      password: auth[1],
      host: params.hostname,
      port: params.port,
      database: params.pathname.split('/')[1],
      max: 10, // max number of clients in the pool
      idleTimeoutMillis: 30000
    };
    this.pgPool = new pg.Pool(pgConfig);
    this.pgPool.on('error', function (err, client) {
      console.error('idle client error', err.message, err.stack)
    })

    if (!fs.existsSync(this.config.store)) {
      mkdirp.sync(this.config.store);
    }
    this.address = address;
    this.path = this.config.store+'/'+address+'.json';
    this.data = {
      address: this.address
    };
    this.thread = null;
    this.state = null;

    this.load(onReady);
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.flush();
  }

  setState(name) {
    this.state = name;
    this.set('_state', name);
  }

  openThread(name) {
    this.closeThread();
    this.set('_thread', name)
    this.thread = this.bot.threads[name];
    this.thread.open(this);
  }

  closeThread() {
    if (this.thread) {
      this.thread.close(this);
    }
    this.thread = null;
    this.set('_thread', null);
    this.setState(null)
  }

  reset() {
    this.closeThread()
    this.setState(null)
    this.data = {
      address: this.address
    };
    this.flush();
  }

  reply(message) {
    this.bot.client.send(this, message);
  }

  rpc(rpcCall, callback) {
    this.bot.client.rpc(this, rpcCall, callback);
  }

  load(onReady) {
    this.execute('SELECT * from bot_sessions WHERE eth_address = $1', [this.address], (err, result) => {
      if (err) { console.log(err) }
      if (!err && result.rows.length > 0) {
        this.data = result.rows[0].data
        if (this.data._thread) {
          this.thread = this.bot.threads[this.data._thread];
        }
        if (this.data._state) {
          this.state = this.data._state;
        }
      } else {
        this.data = {
          address: this.address
        };
      }
      onReady()
    });
  }

  flush() {
    this.data.timestamp = Math.round(new Date().getTime()/1000);
    let query =  `INSERT INTO bot_sessions (eth_address, data)
                  VALUES ($1, $2)
                  ON CONFLICT (eth_address) DO UPDATE
                  SET data = $2`;
    this.execute(query, [this.address, this.data], (err, result) => {
      if (err) { console.log(err) }
    })
  }

  execute(query, args, cb) {
    this.pgPool.connect((err, client, done) => {
      if (err) { return cb(err) }
      client.query(query, args, (err, result) => {
        done(err);
        if (err) { return cb(err) }
        cb(null, result);
      })
    })
  }

  get json() {
    return JSON.stringify(this.data);
  }
}

module.exports = Session;
