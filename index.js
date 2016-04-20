
// constants
var DELAY = 300000; // every 5 minutes
var DAYS_OF_DATA = 5; // keep 5 days worth of data
// var DELAY = 5000;
var FIREBASE_DATA = require('./firebase.json'); // { url, token }
var MY_NAME = require('os').hostname();

// deps
var q = require('q');

// set up firebase tokens
var Firebase = require('firebase');
var FirebaseTokenGenerator = require('firebase-token-generator');
var tokenGenerator = new FirebaseTokenGenerator(FIREBASE_DATA.token);
var TOKEN = tokenGenerator.createToken({ uid: MY_NAME, isTessel: true }, { expires: Date.now() + 8e14 });

var tessel = require('tessel');

// set up climate sensor
var climateReady = q.defer();
var climate = null;
try {
    var climatelib = require('climate-si7020');
    climate = climatelib.use(tessel.port.A);

    climate.on('ready', function() {
        climateReady.resolve();
    });

    climate.on('error', function() {
        console.error('climate error');
        climate = null;
        climateReady.resolve();
    });
} catch(e) {
    climateReady.resolve();
}

// set up ambient sensor
var ambientReady = q.defer();
var ambient = null;
try {
    var ambientlib = require('ambient-attx4');
    ambient = ambientlib.use(tessel.port.B);

    ambient.on('ready', function() {
        ambientReady.resolve();
    });

    ambient.on('error', function() {
        console.error('ambient error');
        ambient = null;
        ambientReady.resolve();
    });
} catch(e) {
    ambientReady.resolve();
}

// connect to firebase
var ROOT = new Firebase(FIREBASE_DATA.url);
ROOT.authWithCustomToken(TOKEN, function(err, success) {
    if(err) {
      console.error(err);
    } else {
      console.log('Authenticated with Firebase successfully.');
    }
});

var DATA = ROOT.child('datapoints');

var resolveWithPrecision = function(promise, number, precision) {
    promise.resolve((number || 0).toFixed(precision));
};

// wait for sensors to load
q.all([climateReady.promise, ambientReady.promise]).then(function() {
    var ambientSensorSound = null;
    var ambientSensorLight = null;
    var climateSensorHumidity = null;
    var climateSensorTemperature = null;

    setInterval(function() {
        var timestamp = new Date();
        tessel.led[2].on();

        if(ambientSensorSound) ambientSensorSound.resolve(0);
        if(ambientSensorLight) ambientSensorLight.resolve(0);
        if(climateSensorHumidity) climateSensorHumidity.resolve(0);
        if(climateSensorTemperature) climateSensorTemperature.resolve(0);

        // read ambient sensor
        ambientSensorSound = q.defer();
        ambientSensorLight = q.defer();
        if(ambient) {
            ambient.getSoundLevel(function(err, soundLevel) {
                if(err) {
                  console.error(err);
                  return ambientSensorSound.resolve(0);
                }
                resolveWithPrecision(ambientSensorSound, soundLevel, 8);
            });
            ambient.getLightLevel(function(err, lightLevel) {
                if(err) {
                  console.error(err);
                  return ambientSensorLight.resolve(0);
                }
                resolveWithPrecision(ambientSensorLight, lightLevel, 8);
            });
        } else {
            ambientSensorSound.resolve(0);
            ambientSensorLight.resolve(0);
        }

        // read climate sensor
        climateSensorHumidity = q.defer();
        climateSensorTemperature = q.defer();
        if(climate) {
            climate.readHumidity(function(err, humidity) {
                if(err) {
                  console.error(err);
                  return climateSensorHumidity.resolve(0);
                }
                resolveWithPrecision(climateSensorHumidity, humidity, 4);
            });

            climate.readTemperature('f', function(err, temperature) {
                if(err) {
                  console.error(err);
                  return climateSensorTemperature.resolve(0);
                }
                resolveWithPrecision(climateSensorTemperature, temperature, 4);
            });
        } else {
            climateSensorHumidity.resolve(0);
            climateSensorTemperature.resolve(0);
        }

        // wait for all sensor data to be received
        q.all([
            ambientSensorSound.promise,
            ambientSensorLight.promise,
            climateSensorHumidity.promise,
            climateSensorTemperature.promise])

            .then(function(data) {
              var result = {
                  sound: +data[0],
                  light: +data[1],
                  humidity: +data[2],
                  temperature: +data[3],
                  timestamp: timestamp.getTime(),
                  reporter: MY_NAME,
                  '.priority': timestamp.getTime()
              };

              DATA.push(result);

              timestamp.setDate(timestamp.getDate()-DAYS_OF_DATA);
              DATA.orderByChild('timestamp').endAt(timestamp.getTime()).on('child_added', function(snap) {
                  snap.ref().remove();
              });

              tessel.led[2].off();
          });

    }, DELAY);
});
