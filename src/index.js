"use strict"

var engine = require('engine.io');
var superagent = require('superagent');
var debug = require('debug')('rebound-server');

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
        debug('Attaching To Engine.io Server.');
        this.engine = engine.attach(this.server);
    }

    saveSocket(){
        this.on('connection', function(socket){

            socket.on('message', function(data){
                data = JSON.parse(data);
                if(data.event == 'socket:csrf' && data.data.hasOwnProperty('token')){
                    debug('Sending Socket ID for save.');

                    socket.csrfToken = data.data.token;

                    superagent.post('/broadcasting/socket')
                        .set(socket.request.headers)
                        .send({socket_id: socket.id, '_token': socket.csrfToken})
                        .end(function(err, res){
                            if(err || !err && res && res.body.status != 'success'){
                                debug('Socket save error!');
                                debug(err);
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

            if(!members.hasOwnProperty(this.channels[channel][mem].member.id)){
                members[this.channels[channel][mem].member.id] = this.channels[channel][mem].member;
                members[this.channels[channel][mem].member.id].socket_ids = [];
            }

            //add socket ids
            if(members[this.channels[channel][mem].member.id].socket_ids.indexOf(mem) == -1){
                members[this.channels[channel][mem].member.id].socket_ids.push(mem);
            }
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

        debug('Adding ' + socket.id + ' to ' + channelName);

        let channel = this.getChannel(channelName);

        channel[socket.id] = socket;

        //confirm
        socket.send(JSON.stringify({
            event: channelName + ':subscription_succeeded',
            data: {},
            channel: channelName
        }));
    }

    sendMemberInfo(channelName, event, member){

        debug('Sending member info for ' + channelName);

        let members = this.getChannelMembers(channelName);

        let sockets = this.getChannel(channelName);

        for(let s in sockets){

            if(!sockets.hasOwnProperty(s)) continue;

            sockets[s].send(JSON.stringify({
                event: channelName + ':' + event,
                members: members,
                member: member,
                channel: channelName,
                data: {}
            }));
        }

    }

    onSubscribe(){
        this.onEvent('subscribe', function(data, socket){
            //verify channel if private or presence??
            if(this.isPrivateChannel(data.channel) || this.isPresenceChannel(data.channel)){

                debug('Requesting channel authentication.');

                superagent.post('/broadcasting/auth')
                    .set(socket.request.headers)
                    .send({channel_name: data.channel, socket_id: socket.id, '_token': socket.csrfToken})
                    .end(function(err, res){
                        if(err || !err && res && res.body.status != 'success'){
                            debug('Channel authentication error!');
                            debug(err);
                            return;
                        }

                        socket.member = {
                            info: res.body.user_info,
                            id: res.body.user_id
                        };

                        //add socket to channel - we are authenticated
                        this.addToChannel(socket, data.channel);

                        //if presence send member info down
                        if(this.isPresenceChannel(data.channel)){
                            this.sendMemberInfo(data.channel, 'member_added', socket.member);
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

            debug('Removing ' + socket.id + ' from ' + data.channel);

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
                    this.sendMemberInfo(data.channel, 'member_removed', socket.member);
                }
            }

        }.bind(this));

    }

    onClose(){
        this.on('connection', function(socket){
            socket.on('close', function(reason){

                debug('Closing socket.');

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

            debug('Sending Event: ' + message.channel + ':' + message.event);

            for(let socket in sockets){

                //dont send if not in channel, or if specified by the event itself via the socket_id property
                if(!sockets.hasOwnProperty(socket) || sockets.hasOwnProperty(socket) && payload.hasOwnProperty('data') && payload.data.hasOwnProperty('socket') && payload.data.socket == socket) continue;

                sockets[socket].send(payload);
            }

        }.bind(this));
    }

}

module.exports = Server;