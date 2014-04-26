var util = require('util');
var stream = require('stream');
var hm = require('heatmiser');
var Device = require('./device');

util.inherits(Driver,stream);

function Driver(opts, app) {
  var self = this;

  this.devices = {};

  this.log = app.log;

  this.opts = opts;

  opts.thermostats = opts.thermostats || {};
  opts.pollInterval = opts.pollInterval || 60000; // 1min default poll

  this.timeoutIds = {};

  app.once('client::up',function(){
    self.save();

    var keys = Object.keys(opts.thermostats);
    for (var i=0; i<keys.length; i++) {
      var name = keys[i];
      if (self.timeoutIds[name] == null) {
        var thermostat = opts.thermostats[name]
        this.log.info("Registering thermostat '%s' at %s:%s", name, thermostat.host, thermostat.port);
        self.poll(name);
      } else {
        this.log.info("Thermostat '%s' at %s:%s already registered", name, thermostat.host, thermostat.port);
      }
    }
  });

}

Driver.prototype.config = function(rpc,cb) {

  var self = this;

  if (!rpc) {
    return cb(null, {
        "contents":[
          { "type": "paragraph", "text":"Heatmiser WiFi" },
          { "type": "input_field_text", "field_name": "name", "value": '', "label": "Friendly name", "placeholder": "living room", "required": false},
          { "type": "input_field_text", "field_name": "host", "value": '', "label": "Heatmiser host", "placeholder": "", "required": true},
          { "type": "input_field_text", "field_name": "port", "value": '', "label": "Heatmiser port", "placeholder": "default to 8068 for WiFi / 4242 for Neo", "required": false},
          { "type": "input_field_password", "field_name": "pin", "value": "", "label": "Heatmiser WiFi pin", "placeholder": "only needed for WiFi thermostat", "required": false},
          { "type": "submit", "name": "Add WiFi", "rpc_method": "addWiFi" },
          { "type": "submit", "name": "Add Neo", "rpc_method": "addNeo" }
        ]
      });
  }

  switch (rpc.method) {
    case 'addWiFi':
    case 'addNeo':

      var name = rpc.params.name.length > 0 ? rpc.params.name : rpc.params.host + "_" + rpc.params.port;
      var obj = {
        'host': rpc.params.host
      };

      var parsePort = function(defaultPort) {
        return (rpc.params.port != null && rpc.params.port != '') ? parseInt(rpc.params.port) : defaultPort
      }

      if (rpc.method == 'addWiFi') {
        obj['port'] = parsePort(8068);
        obj['pin'] = parseInt(rpc.params.pin);
        obj['type'] = Device.WIFI;
      } else {
        obj['port'] = parsePort(4242);
        obj['type'] = Device.NEOHUB;
      }
      self.opts.thermostats[name] = obj;

      self.save();

      cb(null, {
        "contents": [
          { "type":"paragraph", "text":"Successfully saved." },
          { "type":"close", "text":"Close" }
        ]
      });

      self.poll(name);

      break;
    default:
      log('Unknown rpc method', rpc.method, rpc);
  }
};

Driver.prototype.poll = function(name) {
  var self = this;

  var thermostat = this.opts.thermostats[name]

  var heatmiser = thermostat.type == Device.WIFI ? new hm.Wifi(thermostat.host, thermostat.pin, thermostat.port) : new hm.Neo(thermostat.host, thermostat.port);

  heatmiser.on('error', function(error) {
    self.log.error("Heatmiser [%s] error reading data: %s", name, error);
  });

  var pollEach = function(name, data) {
    var deviceId = name.replace(/[^a-zA-Z0-9]/g, '');
    var topic = 'data.' + deviceId;
    if (!self.listeners(topic).length) {
      self.log.info('Heatmiser - Creating Ninja devices for device: %s', deviceId);
      self.createDevices(name, heatmiser, deviceId, data, topic);
    }
    self.emit(topic, data);
  }

  heatmiser.on('success', function(data) {
    if (thermostat.type == Device.WIFI) {
      // wifi
      self.log.debug("Heatmiser [%s:%s] air/floor/target temperature: %d/%d/%d", thermostat.host, thermostat.port, deviceData.dcb.built_in_air_temp, deviceData.dcb.floor_temp, deviceData.dcb.set_room_temp);
      pollEach(name, data.dcb);
    } else {
      // neohub
      for (var i=0; i<data.devices.length; i++) {
        var device = data.devices[i]
        pollEach(device['device'], device);
      }
    }
  });

  // first request
  self.fetchStatus(name, heatmiser);
  // Start continuous polling..
  self.timeoutIds[name] = setInterval(function(){ self.fetchStatus(name, heatmiser); }, this.opts.pollInterval);
};

Driver.prototype.fetchStatus = function(name, heatmiser) {
  this.log.info("Fetching status for thermostat %s at %s:%s", name, heatmiser.host, heatmiser.port);
  heatmiser.info();
};

Driver.prototype.createDevices = function(name, heatmiser, id, deviceData, topic) {

  var self = this;
  var device = new Device(this, name, heatmiser, id, topic);

  // heating state
  this.emit('register', device.heating);

  // air temperature sensor
  this.emit('register', device.airTemp);

  // floor temperature sensor
  if ((deviceData["CURRENT_FLOOR_TEMPERATURE"] != null && deviceData["CURRENT_FLOOR_TEMPERATURE"] < 255) || deviceData.floor_temp != null) {
    this.emit('register', device.floorTemp);
  }

  // target temperature
  this.emit('register', device.targetTemp);

  // temperature hold
  this.emit('register', device.holdTemp);

  // home/away status
  this.emit('register', device.awayMode);

};

module.exports = Driver;
