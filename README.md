ninja-heatmiser
===============

A [Ninja Blocks](http://ninjablocks.com) driver to talk to [Heatmiser](www.heatmiser.co.uk) thermostats

###Overview

Exports any number of Heatmiser Thermostats as NinjaBlocks devices. You can also avoid buying Heatmiser's MultiLink and save over £140.

Each Thermostat will appear as

* Air temperature (sensor)
* Floor temperature, if floor probe installed (sensor)
* Target temperature (actuator)
* Hold time in minutes (actuator)
* Home/Away status (actuator)

###Installation

Clone this repo into your drivers folder and install the dependencies. Restart the ninjablock service and you are good to go.

    cd /opt/ninja/drivers
    git clone https://github.com/carlossg/ninja-heatmiser.git
    cd ninja-heatmiser
    npm install
    sudo service ninjablock restart
    
###Configuration

To add a thermostat go to the [web settings](https://a.ninja.is/you) - Blocks - Configure - Ninja Heatmiser Configure button. Enter a friendly name, host, port and pin of the thermostat. The devices for the sensors and actuators will show up in the Beta Dashboard and you can use the Rules editor to manage the thermostat.

The configuration is stored in

    /opt/ninja/config/ninja-heatmiser/config.json

and can be easily edited

	{
	  "config": {
	    "thermostats": {
	      "living room": {
	        "host": "192.168.1.10",
	        "port": 8068,
	        "pin": 1234
	      }
	    },
	    "pollInterval": 60000
	  }
	}

###TODO

* A better dashboard widget to see all the data in one place and allow manual operation from it
* Automatically sync time to the thermostat and avoid handling DST manually
