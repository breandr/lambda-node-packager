var lambdaNodePackager = require('./index')
console.log(lambdaNodePackager)
lambdaNodePackager.handler({
  "useLegacyBundling": true,
  "package": {
    "name": "lambda-node-packager",
    "version": "1.0.0"
  },
  // "region": "us-east-1",
  // "bucket": "poke-go-sentry",
  "fileName": "s2geometry-node2.zip",
  "dependencies": {
      "s2geometry-node": "^1.3.0"
    }
}
, {
  fail: function(e) {
    console.log(e)
  },
  succeed: function(r) {
    console.log(r)
  }
})
