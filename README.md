# Rebound Server

Rebound Server for the Rebound Client: https://github.com/leemason/rebound-client. Inspired by Laravel Echo.

Put simply its a Pusher like interface using engine.io (the core of socket.io), and redis with events powered by Laravel.

This is for Laravel 5.3 which adds the ability to authenticate sockets, and remember sessions against socket ids.

To test usage you will need to fetch the framework from my fork detailed in this pull request: https://github.com/laravel/framework/pull/13653.

Or mimic the new routes like so, this wont cache the link between socket ids and sessions, or run the channel validation.
But it will let you authenticate and test usage of private/presence channels:

```php
<?php

Route::post('/broadcasting/auth', function(\Illuminate\Http\Request $r){

    //authenticate or abort

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

When 5.3 gets released the laravel side of things will simply involve choosing the rebound driver in your broadcasting config.
Until then you have mimic it like above via the dummy routes, or the forked repo.

The driver works just like the existing redis driver, it just adds a little more functionality on ontop. So make sure you have redis installed and setup.

Managing the socket server though has to be done regardless.

## Installation

```npm install rebound-server --save```

Then create your server file, for example ```websocket.js```, create a http server, and connect to your redis database.

Once that's done you can drop both of them into the Server class, see the example below:


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

To start the server just run ```node websocket.js```.

Long term you would want to run this process via supervisor or something else.

If you used the example above you will see the message "server started!" (debuging stuff to come soon).

The rebound server will now listen on the port specified, and listen for any events published to redis, when that happens the event is pushed out to clients subscribed to the same channel.

Install the client package referenced at the top and open a few browser windows, send some events or listen to presence channel member changes to see it all working.

The package is pretty raw right now, it works, but we have much more to add, along with some debugging messages and tests.

If you find any issues please let me know, or even better open a pull request.

### FAQ

Why not use socket.io?

Well we tried to, all the "features" socket.io gives you really limit its ability to do something different (or at least wit my experience).

This package is still backed by the underlying package engine.io, which is developed by the socket.io teams.
Its just a lower level package and gives use the freedom to implement a system more inline with something like Pusher and the Laravel event system.