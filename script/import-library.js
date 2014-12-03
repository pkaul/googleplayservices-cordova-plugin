// Adds Google PlayServices dependencies to the current Cordova project
// This is done by turning (a copy of) PlayServices into a
// project library and linking it to the current project.
// Requires the Android SDK to be installed locally including ANDROID_HOME environment variable to be set.

module.exports = function(context) {

    var fs = require('fs');
    var path = require('path');
    var exec = require('child_process').exec;

    // see https://github.com/apache/cordova-lib/blob/master/cordova-lib/templates/hooks-README.md
    var Q = context.requireCordovaModule('q');

    var log = function(message) {
        console.info("[cordova-googleplayservices-plugin] "+message);
    };



    var androidHome = process.env.ANDROID_HOME;
    if( !androidHome ) {
        throw new Error("Environment variable ANDROID_HOME is not set to Android SDK directory");
    }
    else {
        log("Found Android SDK at "+androidHome);
    }


    /**
     * Copies an entire directory into another
     */
    var copyRecursiveSync = function(src, dest) {

        try {
            var exists = fs.existsSync(src);
            var stats = exists && fs.statSync(src);
            var isDirectory = exists && stats.isDirectory();
            if (exists && isDirectory) {

                log("Copying "+src+" to "+dest+" ...");
                fs.mkdirSync(dest);
                fs.readdirSync(src).forEach(function (childItemName) {
                    copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
                });
            } else {
                fs.createReadStream(src).pipe(fs.createWriteStream(dest));
            }
        } catch (e) {
            log("Error copying "+src+" to "+dest+": "+e);
        }
    };

    /**
     * Executes an (external) command
     */
    var execCommand = function(command, callback) {

        log("Executing "+command+" ...");
        try {
            var p = exec(command, {maxBuffer: 500 * 1024},function (error, stdout, stderr) {

                if (!!stdout) {
                    log("Exec: " + stdout);
                }
                if (!!stderr) {
                    log("Exec: " + stderr);
                }
                if (!!error) {
                    log("Error executing "+command+": "+error);
                    throw new Error("Error executing "+command+": "+error);
                }
            });
            p.on("close", function (code) {
                if (code !== 0) {
                    log("Error executing "+command+": "+code);
                    throw new Error("Error executing " + command + ": " + code);
                }
                log("Executed " + command);
                if (!!callback) {
                    callback();
                }
            });
        } catch (e) {
            log("Error executing "+command+": "+code);
            throw new Error("Error executing " + command + ": " + code);
        }
    };

    /**
     * Turns a project into an android "library project"
     * @param path The location of the project
     */
    var prepareLibraryProject = function(path, callback) {

        log("Preparing project library at "+path+" ...");
        execCommand(androidHome+"/tools/android update lib-project -p "+path, function() {
            execCommand("ant clean -f "+path+"/build.xml", function() {
                execCommand("ant release -f "+path+"/build.xml", function() {

                    console.info("Turned "+path+" into a library project");
                    if(!!callback ) {
                        callback();
                    }
                });
            });
        });
    };


    /**
     * Sets the api version in project's properties
     */
    var updateProjectApiVersion = function(path, apiVersion) {

        var propertiesPath = path+"/project.properties";
        var data = fs.readFileSync(propertiesPath, 'utf8');
        data = data.replace(/target=android-(\d+)/, "target=android-"+apiVersion);
        fs.writeFileSync(propertiesPath, data, "UTF-8",{'flags': 'w+'});
        log("Updated "+propertiesPath+" with android api version "+apiVersion);
    };


    /**
     * Adds a library reference to a "library project"
     * @param libraryPath path The location of the project
     * @param referencePaths The relative locations of the references
     */
    var addLibraryReference = function(libraryPath, referencePaths, callback) {
        var projectProperties = libraryPath+"/project.properties";
        log("Adding references "+referencePaths+" to "+projectProperties);
        fs.readFile(projectProperties, 'utf8', function (err,data) {
            if (err) {
                throw new Error("Error reading "+projectProperties);
            }
            // find the next available reference index
            var referenceIndex = 1;
            while( data.indexOf('android.library.reference.'+referenceIndex) > -1 ) {
                referenceIndex++;
            }
            // compute the entries to be appended
            var appends = "";
            for( var i=0; i<referencePaths.length; i++ ) {
                appends += "\n\randroid.library.reference."+(i+referenceIndex)+"="+referencePaths[i];
            }
            // append
            fs.appendFile(projectProperties, appends, function (err) {
                log("Added references to "+projectProperties+": "+appends);
                if( !!callback ) {
                    callback();
                }
            });
        });
    };


// -------------------------------


    var targetDir        = context.opts.plugin.dir;  // use this plugin's directory as a working dir
    targetDir = targetDir.replace(/\\/g,'/'); // normalize path separators for Windows

    //var androidApiVersion   = 21;  // TODO make this configurable via environment

    var appCompatLib            = targetDir+'/appcompat_lib';
    var appCompatSourceLib      = androidHome+"/extras/android/support/v7/appcompat";

    var mediaRouterLib          = targetDir+'/mediarouter_lib';
    var mediaRouterSourceLib    = androidHome+"/extras/android/support/v7/mediarouter";

    var playServicesLib         = targetDir+'/google-play-services_lib';
    var playServicesSourceLib   = androidHome+"/extras/google/google_play_services/libproject/google-play-services_lib";


    var deferral = new Q.defer();

    copyRecursiveSync(appCompatSourceLib+'/', appCompatLib+'/');
    copyRecursiveSync(mediaRouterSourceLib+'/', mediaRouterLib+'/');
    copyRecursiveSync(playServicesSourceLib+'/', playServicesLib+'/');

    // --- turn AppCompatLib into a library project
    prepareLibraryProject(appCompatLib, function() {

        // --- turn MediarouterLib into a library project (after adjusting dependencies)
        addLibraryReference(mediaRouterLib, ['../appcompat_lib'], function() {    // HACK: A _relative_ path is required here!
            prepareLibraryProject(mediaRouterLib, function () {

                // --- turn PlayServicesLib into a library project
                //updateProjectApiVersion(playServicesLib, androidApiVersion);   // TODO problem when using Android Api version 21+
                prepareLibraryProject(playServicesLib, function () {
                    // add all three libraries to current project
                    deferral.resolve();
                });
            });
        });
    });

    return deferral.promise;
};







