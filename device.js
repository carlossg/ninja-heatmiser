var util = require('util');
var stream = require('stream');

function Device(driver, name, heatmiser, id, topic) {
  var self = this;
  this.driver = driver;
  this.log = driver.log;
  this.name = name;
  this.heatmiser = heatmiser;
  this.id = id;
  this.topic = topic;

  this.heating = new Heating(this);
  this.airTemp = new AirTemp(this);
  this.floorTemp = new FloorTemp(this);
  this.targetTemp = new TargetTemp(this);
  this.holdTemp = new HoldTemp(this);
  this.awayMode = new AwayMode(this);
}

Device.NEOHUB = 'neohub';
Device.WIFI = 'wifi';

Device.prototype.writeToWifiThermostat = function(data) {
  var self = this;

  var success = function(deviceData) {
    self.log.info('Heatmiser [%s] data written: %s', name, JSON.stringify(data));
    self.heatmiser.removeListener('success', success);
    self.heatmiser.removeListener('error', error);
  }
  var error = function(msg) {
    self.log.error('Heatmiser [%s] Error writing data %s: %s', name, JSON.stringify(data), msg);
    self.heatmiser.removeListener('success', success);
    self.heatmiser.removeListener('error', error);
  }

  self.heatmiser.once('success', success);
  self.heatmiser.once('error', error);

  try {
    self.heatmiser.write_device(data);
  } catch (e) {
    self.log.error('Heatmiser [%s] Error writing data %s: %s', name, JSON.stringify(data), e);
    self.heatmiser.removeListener('success', success);
    self.heatmiser.removeListener('error', error);
  }
}

// heating state
function Heating(device) {
  this.writable = false;
  this.readable = true;
  this.V = 0;
  this.D = 244;
  this.G = 'heatmiser' + device.id + 'heating';
  this.name = device.name + ' Heating';

  device.driver.on(device.topic, function(deviceData) {
    var heating = deviceData["HEATING"] != null ? deviceData["HEATING"] : deviceData.heating_on
    device.log.debug('Heatmiser [%s] heating: %s', device.name, heating);
    device.heating = heating;
    this.emit('data', heating.toString());
  }.bind(this));
}
util.inherits(Heating,stream);


// air temperature sensor
function AirTemp(device) {
  this.writable = false;
  this.readable = true;
  this.V = 0;
  this.D = 9;
  this.G = 'heatmiser' + device.id + 'current';
  this.name = device.name + ' Air Temperature';

  device.driver.on(device.topic, function(deviceData) {
    var temp = deviceData["CURRENT_TEMPERATURE"] != null ? deviceData["CURRENT_TEMPERATURE"] : deviceData.built_in_air_temp
    device.log.debug('Heatmiser [%s] Air temperature: %d', device.name, temp);
    device.airTemp = temp;
    this.emit('data', temp);
  }.bind(this));
}
util.inherits(AirTemp,stream);


// floor temperature sensor
function FloorTemp(device) {
  this.writable = false;
  this.readable = true;
  this.V = 0;
  this.D = 9;
  this.G = 'heatmiser' + device.id + 'floor';
  this.name = device.name + ' Floor Temperature';

  device.driver.on(device.topic, function(deviceData) {
    var temp = deviceData["CURRENT_FLOOR_TEMPERATURE"] != null ? deviceData["CURRENT_FLOOR_TEMPERATURE"] : deviceData.floor_temp
    device.log.debug('Heatmiser [%s] Floor temperature: %d', device.name, temp);
    device.floorTemp = temp;
    this.emit('data', temp);
  }.bind(this));
}
util.inherits(FloorTemp,stream);


// target temperature
function TargetTemp(device) {
  this.writable = true;
  this.readable = true;
  this.V = 0;
  this.D = 9;
  this.G = 'heatmiser' + device.id + 'target';
  this.name = device.name + ' Target Temperature';

  device.driver.on(device.topic, function(deviceData) {
    var temp = deviceData["CURRENT_SET_TEMPERATURE"] != null ? deviceData["CURRENT_SET_TEMPERATURE"] : deviceData.set_room_temp
    device.log.debug('Heatmiser [%s] Target temperature: %d', device.name, temp);
    device.targetTemp = temp;
    this.emit('data', temp);
  }.bind(this));

  this.write = function(data) {
    if (typeof data == 'string') {
      try {
        data = parseFloat(data);
      } catch(e) {}
    }
    if (typeof data != 'number' || isNaN(data) ) {
      device.log.error('Heatmiser [%s] Tried to set target temperature with a non-number : %s', device.name, data);
      return;
    }

    device.targetTemp = data;

    device.log.debug('Heatmiser [%s] Setting target temperature to : %s', device.name, data);
    if (device.heatmiser.type == Device.WIFI) {
      device.writeToWifiThermostat({ heating: { target: data } });
    } else {
      device.heatmiser.setTemperature(data, [device.name], function(){
        device.log.info('Heatmiser [%s] set temperature to: %d', device.name, data);
      });
    }
  };
}
util.inherits(TargetTemp,stream);


// temperature hold
function HoldTemp(device) {
  this.writable = true;
  this.readable = true;
  this.V = 0;
  this.D = 2000;
  this.G = 'heatmiser' + device.id + 'hold';
  this.name = device.name + ' Hold in minutes';

  device.driver.on(device.topic, function(deviceData) {
    var hold;
    if (deviceData["HOLD_TIME"] != null) {
      // convert hour:minutes to minutes
      var array = deviceData["HOLD_TIME"].split(":");
      hold = parseInt(array[0])*60 + parseInt(array[1]);
    } else {
      hold = deviceData.temp_hold_minutes;
    }
    device.log.debug('Heatmiser [%s] Temperature Hold: %d', device.name, hold);
    device.holdTemp = hold;
    this.emit('data', hold);
  }.bind(this));

  this.write = function(data) {
    if (typeof data == 'string') {
      try {
        data = parseInt(data);
      } catch(e) {}
    }
    if (typeof data != 'number' || isNaN(data) ) {
      device.log.error('Heatmiser [%s] Tried to set temperature hold with a non-number : %s', device.name, data);
      return;
    }

    device.log.debug('Heatmiser [%s] Setting temperature hold to: %d', device.name, data);
    device.holdTemp = data;
    if (device.heatmiser.type == Device.WIFI) {
      device.writeToWifiThermostat({ heating: { hold: data } });
    } else {
      var hours = Math.floor(data/60);
      var minutes = data%60;
      device.heatmiser.setHold(device.id, device.targetTemp, hours, minutes, [device.name], function(){
        device.log.info('Heatmiser [%s] set hold to %d for %d:%s', device.name, device.targetTemp, hours, minutes < 10 ? "0"+minutes : minutes);
      });
    }
  };
}
util.inherits(HoldTemp,stream);


// home/away status
function AwayMode(device) {
  this.writable = true;
  this.readable = true;
  this.V = 0;
  this.D = 244;
  this.G = 'heatmiser' + device.id + 'away';
  this.name = device.name + ' Away mode';

  device.driver.on(device.topic, function(deviceData) {
    var away;
    if (deviceData["AWAY"] != null) {
      away = deviceData["AWAY"];
    } else {
      if (deviceData.model.match(/(HW|TM1)$/)) {
        // hotwater
        away = deviceData.away_mode
      } else {
        away = (deviceData.run_mode == 'frost_protection')
      }
    }
    device.log.debug('Heatmiser [%s] Away: %s', device.name, away);
    device.awayMode = away;
    this.emit('data', away.toString());
  }.bind(this));

  this.write = function(data) {
    if (typeof data == 'string') {
      data = data == 'true';
    }
    device.log.debug('Heatmiser [%s] Setting away mode to : %s', device.name, data);
    // set both hotwater and heating on/off
    device.awayMode = data;
    if (device.heatmiser.type == Device.WIFI) {
      device.writeToWifiThermostat({ away_mode: data, run_mode: (data ? 'frost_protection' : 'heating')});
    } else {
      device.heatmiser.setAway(data, [device.name], function(){
        device.log.info('Heatmiser [%s] set away to: %s', device.name, data);
      });
    }
  };
}
util.inherits(AwayMode,stream);

module.exports = Device;
