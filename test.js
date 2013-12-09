var prompt = require('prompt');

var properties = [
    {
      name: 'username'
    },
    {
      name: 'password',
      hidden: true
    }
];

prompt.start();

prompt.get(properties, function (err, result) {
    //if (err) { throw new Error(err); }

    var EventEmitter = require('events').EventEmitter;

    var opts = result;

    var app = new EventEmitter();
    app.log = {
        debug: console.log,
        info: console.log,
        warn: console.log,
        error: console.log
    };

    var driver = new (require('./index'))(opts, app);

    driver.on('register', function(device) {
        console.log('Driver.register', device);
        device.on('data', function(value) {
            console.log('Device.emit data', value);
        });

        if (device.writable) {
            setTimeout(function() {
                prompt.get(['target_temperature'], function(err, result) {
                    device.write(parseFloat(result.target_temperature));
                });
            }, 2000);
        }
    });

    driver.save = function() {
        console.log('Saved opts', opts);
    };

    setTimeout(function() {
        app.emit('client::up');
    }, 500);

});
