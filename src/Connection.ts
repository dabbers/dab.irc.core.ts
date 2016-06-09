
import net = require('net');
import tls = require('tls');
import {IConnectionContext} from './IConnectionContext';
import {IModule} from './IModule';
import {ICloneable} from './ICloneable';
import {Message} from './Message';

var PriorityQueue = require('js-priority-queue');

class OutMessage {
    message : string;
    timestamp : number;

    constructor(msg:string, ts:number = (new Date().getTime())) {
        this.message = msg;
        this.timestamp = ts;
    }
}

export class Connection implements ICloneable, IModule {
    private context:IConnectionContext;

    private socket : net.Socket | tls.ClearTextStream;
    private connectionEstablished : boolean = false;
    private queue = new PriorityQueue({
        comparator: function(a : OutMessage, b : OutMessage) { 
            return a.timestamp-b.timestamp;
        }});
    private interval:number = 200;
    private backlog:string = "";
        
    init(context : IConnectionContext) : void {
        this.context = context;
        context.connection = this;

        var connectionEstablished = () => {
             this.connectionEstablished = true; 
             
             this.raw("NICK " + this.context.me.nick);
             this.raw("USER " + this.context.me.ident + " 8 * :" + this.context.me.name);
        };

        if (context.ssl) {
            this.socket = tls.connect(context.port, context.host, {rejectUnauthorized: context.rejectUnauthedCerts}, connectionEstablished);
        }
        else {
            this.socket = net.createConnection(context.port, context.host, connectionEstablished);            
        }

        this.socket.setEncoding('utf8');
        this.socket.on('data', (d:string) => this.onData.apply(this, [d]));
        this.socket.on('end', () => { this.connectionEstablished = false; });
        this.socket.on('error', () => { this.connectionEstablished = false; } );
    }

    resume(state : any) : void {
        this.socket = state.socket;
        this.context = state.context;
        this.queue = state.queue;
        this.connectionEstablished = state.connectionEstablished;
    }

    uninit() : any {
        return {
            socket: this.socket,
            context: this.context,
            queue: this.queue,
            connectionEstablished: this.connectionEstablished
        };
    }

    disconnect() : void {
        
        if (this.connectionEstablished) {

            this.socket.end();
        }
    }


    // http://stackoverflow.com/a/10012306/486058
    private onData(data : string) {
        this.backlog += data;
        var n = this.backlog.indexOf('\n');

        // got a \n? emit one or more 'line' events
        while (~n) {
            
            var res = this.backlog.substring(0, n);

            if (this.backlog[n-1] == '\r') {
                res = this.backlog.substring(0, n-1);
            }

            if (this.context.logReceivedMessages) console.log("<= ", res);
            
            this.context.dataCallback( new Message(res) );

            this.backlog = this.backlog.substring(n + 1);
            n = this.backlog.indexOf('\n');
        }

    }


    // Can accept a string or an array of strings to send.
    // Please use an array of strings to take use of the prioity queue.
    // You can also send in a {"timestamp":int, "message":string} object where 
    // timestamp is an epoch timestamp in milliseconds (normal epoch * 1000 or new Date().getTime())
    write(msg: string | string[] | any) {
        if (typeof msg == "string") {
            if (this.queue.length == 0) {
                this.raw(<string>msg);
            }
            else {
                this.queue.queue(new OutMessage(<string>msg));
            }
        }
        else if (msg.constructor == Array) {
            if (msg.length == 1 && this.queue.length == 0) {
                this.raw(msg[0]);
            }
            else {
                var date = new Date().getTime();

                for(var i = 0; i < msg.length; i++) {
                    this.queue.queue(new OutMessage(msg[i], date+ (this.interval * i)));
                }
            }
        }
        else {
            this.queue.queue({"timestamp":msg.timestamp, "message":msg.message});        
        }

    }

    private raw(msg:string) {
        
        if (this.context.logSentMessages) console.log("=> ", msg);

        this.socket.write(msg + "\r\n");
    }


    clone() : ICloneable {
        return this;
    }

    toString() :string {
        return "[" + this.context.host + ":" + (this.context.ssl ? "+" : "") + this.context.port.toString() +" Connection]";
    }

    get host() :string { 
        return this.context.host;
    }
    get port() :number { 
        return this.context.port;
    }
    get ssl() :boolean { 
        return this.context.ssl;
    }
    get display() :string {
        return this.toString();
    }
    get connected() :boolean {
        return this.connectionEstablished;
    }
}