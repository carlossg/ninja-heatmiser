var util = require('util');
var stream = require('stream');
var Heatmiser = require('heatmiser');

util.inherits(Driver,stream);

function Driver(opts, app) {
  var self = this;

  this.devices = {};

  this.log = app.log;

  this.opts = opts;

  opts.thermostats = opts.thermostats || {};
  opts.pollInterval = opts.pollInterval || 60000; // 1min default poll

  app.once('client::up',function(){
    self.save();

    var keys = Object.keys(opts.thermostats);
    for (var i=0; i<keys.length; i++) {
      var name = keys[i];
      var thermostat = opts.thermostats[name]
      this.log.info("Registering thermostat '%s' at %s:%s", name, thermostat.host, thermostat.port);
      self.poll(name);
    }
  });

}

Driver.prototype.config = function(rpc,cb) {

  var self = this;

  if (!rpc) {
    return cb(null, {
        "contents":[
          { "type": "input_field_text", "field_name": "name", "value": '', "label": "Friendly name", "placeholder": "living room", "required": false},
          { "type": "input_field_text", "field_name": "host", "value": '', "label": "Heatmiser host", "placeholder": "", "required": true},
          { "type": "input_field_text", "field_name": "port", "value": '8068', "label": "Heatmiser port", "placeholder": "8068", "required": true},
          { "type": "input_field_password", "field_name": "pin", "value": "", "label": "Heatmiser pin", "placeholder": "", "required": true},
          { "type": "submit", "name": "Add", "rpc_method": "setCredentials" }
        ]
      });
  }

  switch (rpc.method) {
    case 'setCredentials':

      var name = rpc.params.name.length > 0 ? rpc.params.name : rpc.params.host + "_" + rpc.params.port;
      self.opts.thermostats[name] = {
        'host': rpc.params.host,
        'port': parseInt(rpc.params.port),
        'pin': parseInt(rpc.params.pin)
      };

      self.save();

      cb(null, {
        "contents": [
          { "type":"paragraph", "text":"Successfully saved." },
          { "type":"close", "text":"Close" }
        ]
      });

      break;
    default:
      log('Unknown rpc method', rpc.method, rpc);
  }
};

Driver.prototype.poll = function(name) {
  var self = this;

  var thermostat = this.opts.thermostats[name]
  var deviceId = name.replace(/[^a-zA-Z0-9]/g, '');

  var heatmiser = new Heatmiser(thermostat.host, thermostat.pin, thermostat.port);

  heatmiser.on('error', function(error) {
    self.log.error("Heatmiser [%s] error reading data: %s", name, error);
  });

  heatmiser.on('success', function(deviceData) {
    self.log.debug("Heatmiser [%s:%s] air/floor/target temperature: %d/%d/%d", thermostat.host, thermostat.port, deviceData.dcb.built_in_air_temp, deviceData.dcb.floor_temp, deviceData.dcb.set_room_temp);
    var topic = 'data.' + deviceId;
    if (!self.listeners(topic).length) {
      self.log.info('Heatmiser - Creating Ninja devices for device: %s', deviceId);
      self.createDevices(name, heatmiser, deviceId, deviceData.dcb, topic);
    }
    self.emit(topic, deviceData.dcb);
  });

  // first request
  self.fetchStatus(name, heatmiser);
  // Start continuous polling..
  setInterval(function(){ self.fetchStatus(name, heatmiser) }, this.opts.pollInterval);
};

Driver.prototype.fetchStatus = function(name, heatmiser) {
  this.log.info("Fetching status for thermostat %s at %s:%s", name, heatmiser.host, heatmiser.port);
  heatmiser.read_device();
};

Driver.prototype.createDevices = function(name, heatmiser, id, deviceData, topic) {

  var self = this;

  var writeThermostat = function(heatmiser, data) {
    var success = function(deviceData) {
      self.log.info('Heatmiser [%s] data written: %s', name, JSON.stringify(data));
      heatmiser.removeListener('success', success);
      heatmiser.removeListener('error', error);
    }
    var error = function(msg) {
      self.log.error('Heatmiser [%s] Error writing data %s: %s', name, JSON.stringify(data), msg);
      heatmiser.removeListener('success', success);
      heatmiser.removeListener('error', error);
    }

    heatmiser.once('success', success);
    heatmiser.once('error', error);

    try {
      heatmiser.write_device(data);
    } catch (e) {
      self.log.error('Heatmiser [%s] Error writing data %s: %s', name, JSON.stringify(data), e);
      heatmiser.removeListener('success', success);
      heatmiser.removeListener('error', error);
    }
  }

  // heating state
  function Heating() {
    this.writable = false;
    this.readable = true;
    this.V = 0;
    this.D = 244;
    this.G = 'heatmiser' + id + 'heating';
    this.name = name + ' Heating';

    self.on(topic, function(deviceData) {
      self.log.debug('Heatmiser [%s] heating: %s', name, deviceData.heating_on);
      this.emit('data', deviceData.heating_on);
    }.bind(this));
  }
  util.inherits(Heating,stream);
  this.emit('register', new Heating());


  // air temperature sensor
  function AirTemp() {
    this.writable = false;
    this.readable = true;
    this.V = 0;
    this.D = 9;
    this.G = 'heatmiser' + id + 'current';
    this.name = name + ' Air Temperature';

    self.on(topic, function(deviceData) {
      self.log.debug('Heatmiser [%s] Air temperature: %d', name, deviceData.built_in_air_temp);
      this.emit('data', deviceData.built_in_air_temp);
    }.bind(this));
  }
  util.inherits(AirTemp,stream);
  this.emit('register', new AirTemp());


  // floor temperature sensor
  if (deviceData.floor_temp != null) {
    function FloorTemp() {
      this.writable = false;
      this.readable = true;
      this.V = 0;
      this.D = 9;
      this.G = 'heatmiser' + id + 'floor';
      this.name = name + ' Floor Temperature';

      self.on(topic, function(deviceData) {
        self.log.debug('Heatmiser [%s] Floor temperature: %d', name, deviceData.floor_temp);
        this.emit('data', deviceData.floor_temp);
      }.bind(this));
    }
    util.inherits(FloorTemp,stream);
    this.emit('register', new FloorTemp());
  }


  // target temperature
  function TargetTemp() {
    this.writable = true;
    this.readable = true;
    this.V = 0;
    this.D = 9;
    this.G = 'heatmiser' + id + 'target';
    this.name = name + ' Target Temperature';

    self.on(topic, function(deviceData) {
      self.log.debug('Heatmiser [%s] Target temperature: %d', name, deviceData.set_room_temp);
      this.emit('data', deviceData.set_room_temp);
    }.bind(this));

    this.write = function(data) {
      if (typeof data == 'string') {
        try {
          data = parseFloat(data);
        } catch(e) {}
      }
      if (typeof data != 'number' || isNaN(data) ) {
        self.log.error('Heatmiser [%s] Tried to set target temperature with a non-number : %s', name, data);
        return;
      }

      self.log.debug('Heatmiser [%s] Setting target temperature to : %s', name, data);
      writeThermostat(heatmiser, { heating: { target: data } });
    };
  }
  util.inherits(TargetTemp,stream);
  this.emit('register', new TargetTemp());


  // temperature hold
  function HoldTemp() {
    this.writable = true;
    this.readable = true;
    this.V = 0;
    this.D = 2000;
    this.G = 'heatmiser' + id + 'hold';
    this.name = name + ' Hold in minutes';

    self.on(topic, function(deviceData) {
      self.log.debug('Heatmiser [%s] Temperature Hold: %d', name, deviceData.temp_hold_minutes);
      this.emit('data', deviceData.temp_hold_minutes);
    }.bind(this));

    this.write = function(data) {
      if (typeof data == 'string') {
        try {
          data = parseInt(data);
        } catch(e) {}
      }
      if (typeof data != 'number' || isNaN(data) ) {
        self.log.error('Heatmiser [%s] Tried to set temperature hold with a non-number : %s', name, data);
        return;
      }

      self.log.debug('Heatmiser [%s] Setting temperature hold to : %d', name, data);
      writeThermostat(heatmiser, { heating: { hold: data } });
    };
  }
  util.inherits(HoldTemp,stream);
  this.emit('register', new HoldTemp());


  // home/away status
  function AwayMode() {
    this.writable = true;
    this.readable = true;
    this.V = 0;
    this.D = 244;
    this.G = 'heatmiser' + id + 'away';
    this.name = name + ' Away mode';

    self.on(topic, function(deviceData) {
      self.log.debug('Heatmiser [%s] Away mode: %s', name, deviceData.away_mode);
      this.emit('data', deviceData.away_mode);
    }.bind(this));

    this.write = function(data) {
      if (typeof data == 'string') {
        data = data == 'true';
      }
      self.log.debug('Heatmiser [%s] Setting away mode to : %s', name, data);
      writeThermostat(heatmiser, { away_mode: data });
    };
  }
  util.inherits(AwayMode,stream);
  this.emit('register', new AwayMode());

};

module.exports = Driver;
