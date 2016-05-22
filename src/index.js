"use strict"

var engine = require('engine.io');
var superagent = require('superagent');

class Server{

    constructor(srv, redis){

        this.server = srv;

        this.channels = {};

        this.redis = redis;

        //attach to http server
        this.attachServer();

        //send socket id to laravel
        this.saveSocket();

        //add sockets on subscibe
        this.onSubscribe();

        //remove members on leave
        this.onLeave();

        //remove members on close
        this.onClose();

        //listen to redis for events
        this.sendEvents();
    }

    attachServer(){
        this.engine = engine.attach(this.server);
    }

    saveSocket(){
        this.on('connection', function(socket){

            socket.on('message', function(data){
                data = JSON.parse(data);
                if(data.event == 'socket:csrf' && data.data.hasOwnProperty('token')){

                    socket.csrfToken = data.data.token;

                    superagent.post('/broadcasting/socket')
                        .set(socket.request.headers)
                        .send({socket_id: socket.id, '_token': socket.csrfToken})
                        .end(function(err, res){
                            if(err || !err && res && res.body.status != 'success'){
                                console.log(err);
                                return;
                            }
                        }.bind(this));
                }
            });
        });
    }

    on(event, cb){
        return this.engine.on(event, cb.bind(this));
    }

    onMessage(cb){
        this.on('connection', function(socket) {
            socket.on('message', function (data) {
                data = JSON.parse(data);
                cb(data, socket);
            });
        });
    }

    onEvent(event, cb){
        this.onMessage(function(data, socket){
            if(data.event == event && data.hasOwnProperty('channel')) {
                cb(data, socket);
            }
        });
    }

    getChannel(channel){
        this.channels[channel] = (this.channels.hasOwnProperty(channel)) ? this.channels[channel] : {};
        return this.channels[channel];
    }

    getChannelMembers(channel){
        let members = {};

        for(let mem in this.getChannel(channel)){
            members[this.channels[channel][mem].id] = this.channels[channel][mem].user;
        }

        return members;
    }

    isPresenceChannel(channel){
        return channel.lastIndexOf('presence-', 0) === 0;
    }

    isPrivateChannel(channel){
        return channel.lastIndexOf('private-', 0) === 0;
    }

    addToChannel(socket, channelName){

        let channel = this.getChannel(channelName);

        channel[socket.id] = socket;

        //confirm
        socket.send(JSON.stringify({
            event: channelName + ':subscribed',
            data: {},
            channel: channelName
        }));
    }

    sendMemberInfo(channelName, event){

        let members = this.getChannelMembers(channelName);

        let sockets = this.getChannel(channelName);

        for(let s in sockets){

            if(!sockets.hasOwnProperty(s)) continue;

            sockets[s].send(JSON.stringify({
                event: channelName + ':' + event,
                members: members,
                channel: channelName,
                data: {}
            }));
        }

    }

    onSubscribe(){
        this.onEvent('subscribe', function(data, socket){
            //verify channel if private or presence??
            if(this.isPrivateChannel(data.channel) || this.isPresenceChannel(data.channel)){

                //console.log(socket.request);

                superagent.post('/broadcasting/auth')
                    .set(socket.request.headers)
                    .send({channel_name: data.channel, socket_id: socket.id, '_token': socket.csrfToken})
                    .end(function(err, res){
                        if(err || !err && res && res.body.status != 'success'){
                            console.log(err);
                            return;
                        }

                        socket.user = res.body.user;

                        //add socket to channel - we are authenticated
                        this.addToChannel(socket, data.channel);

                        //if presence send member info down
                        if(this.isPresenceChannel(data.channel)){
                            this.sendMemberInfo(data.channel, 'member_added');
                        }

                    }.bind(this));

            }else{

                //add socket to channel
                this.addToChannel(socket, data.channel);

            }
        }.bind(this));
    }

    onLeave(){

        this.onEvent('leave', function(data, socket){

            //remove socket fom channel
            this.channels[data.channel] = (this.channels.hasOwnProperty(data.channel)) ? this.channels[data.channel] : {};

            if(this.channels[data.channel].hasOwnProperty(socket.id)){
                delete this.channels[data.channel][socket.id];

                //confirm
                socket.send(JSON.stringify({
                    event: data.channel + ':left',
                    data: {},
                    channel: data.channel
                }));

                //if presence send member info down
                if(this.isPresenceChannel(data.channel)){
                    this.sendMemberInfo(data.channel, 'member_removed');
                }
            }

        }.bind(this));

    }

    onClose(){
        this.on('connection', function(socket){
            socket.on('close', function(reason){

                for(let id in this.channels){

                    if(!this.channels[id].hasOwnProperty(socket.id)) continue;

                    delete this.channels[id][socket.id];

                    //if presence send member info down
                    if(this.isPresenceChannel(id)){
                        this.sendMemberInfo(id, 'member_removed');
                    }
                }

            }.bind(this));
        }.bind(this));
    }

    sendEvents(){

        this.redis.psubscribe('*', function (err, count) {});

        this.redis.on('pmessage', function(subscribed, channel, message) {

            message = JSON.parse(message);
            message.channel = channel;
            let payload = JSON.stringify(message);

            // we only send to the people subscribed to channels, not everyone.
            // that way we can remove any need to do message security on the front end as we already authenticated.
            let sockets = this.getChannel(channel);

            for(let socket in sockets){

                //dont send if not in channel, or if specified by the event itself via the socket_id property
                if(!sockets.hasOwnProperty(socket) || sockets.hasOwnProperty(socket) && payload.data.hasOwnProperty('socket') && payload.data.socket == socket) continue;

                sockets[socket].send(payload);
            }

        }.bind(this));
    }

}

module.exports = Server;