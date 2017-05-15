const WebSocket = require('ws');
const enigma = require('enigma.js');
const qixSchema = require('./node_modules/enigma.js/schemas/qix/3.1/schema.json');

const baseConfig = {
  schema: qixSchema,
  createSocket: url => new WebSocket(url, {}),
  handleLog: logRow => console.log(logRow),
};

const session = {
  unsecure: true,
  host: 'localhost',
  port: 80,
  route: '/doc/doc/57dc24b9ef467c0001977248',
};
enigma.getService('qix', baseConfig, { session: session}).then((qix) => {
  return qix.global.getActiveDoc().then((doc) => {
    doc.getAppLayout().then( (layout) => {
      console.log("AppLayout", layout);
    } )
  });
}).catch((err) => {
  console.log(`Error when connecting to qix service: ${err}`, err);
  process.exit(1);
});
