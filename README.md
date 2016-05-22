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
}).listen(3000, function(){ //port can be anything you want
    console.log('server started!');
});

var redis = new Redis();//redis config must match laravel redis config to use the same db


var srv = new Server(nodeServer, redis);

```

## Authenticating Channels

Right now this is done by a simple post route:

```php
<?php

Route::post('/broadcasting/auth', function(\Illuminate\Http\Request $r){


    //socket_id = $r->socket_id
    //channel_name = $r->channel_name

    if(/* not allowed */){
        abort(403);
    }

    //return success and what user info you want available in the presence channels under the user key
    return ['status' => 'success', 'user' => $r->user()];

});

Route::post('/broadcasting/socket', function(\Illuminate\Http\Request $r){


    //cache the socket id against session id $r->socket_id

    return ['status' => 'success'];

});
```

But this will be changing soon to intergrate with whatever the final interface is for laravel 5.3 (and there will be a package for it, if its not intergrated into the core).