# rebound-server
Rebound Server for Laravel Echo inspired Rebound-client

Simple server to respond to redis events sent via laravel.

## Example

```javascript
"use strict"

var http = require('http');
var Redis = require('ioredis');
var Server = require('rebound-server');


var nodeServer = http.Server(function(req, res){
    res.writeHead(404);
    res.end();
}).listen(3000, function(){
    console.log('server started!');
});

var redis = new Redis();


var srv = new Server(nodeServer, redis);

```
