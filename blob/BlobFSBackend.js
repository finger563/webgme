/**
 * Created by zsolt on 4/19/14.
 */

define(['./BlobBackendBase',
    'fs',
    'crypto',
    'path',
    'util',
    'util/guid',
    'util/ensureDir'],
    function (BlobBackendBase, fs, crypto, path, util, GUID, ensureDir) {

    var BlobFSBackend = function () {
        BlobBackendBase.call(this);
        this.blobDir = path.join('./', 'blob-local-storage');
    };

    // Inherits from BlobManagerBase
    BlobFSBackend.prototype = Object.create(BlobBackendBase.prototype);

    // Override the constructor with this object's constructor
    BlobFSBackend.prototype.constructor = BlobFSBackend;


    BlobFSBackend.prototype.putObject = function (readStream, bucket, callback) {
        // TODO generate a GUID or something for the temporary filename to allow parallel functioning
        var self = this,
            tempName = path.join(self.blobDir, self.tempBucket, GUID() + ".tbf"),// TODO: create this in the system temp folder
            shasum = crypto.createHash(this.shaMethod),
            size = 0;

        ensureDir(path.dirname(tempName), function (err) {
            if (err) {
                callback(err);
                return;
            }

            var writeStream = fs.createWriteStream(tempName);

            writeStream.on('finish', function () {
                // at this point the temporary file have been written out
                // now the file have been written out
                // finalizing hash and moving temporary file..
                var hash = shasum.digest('hex'),
                    objectFilename = path.join(self.blobDir, bucket, self._getObjectRelativeLocation(hash));

                ensureDir(path.dirname(objectFilename), function (err) {
                    if (err) {
                        // FIXME: this code has to be reviewed.
                        fs.unlink(tempName, function (e) {
                            callback(err);
                        });
                        return;
                    }

                    fs.rename(tempName, objectFilename, function (err) {
                        // FIXME: this code has to be reviewed.
                        if (err) {
                            fs.unlink(tempName, function (e) {
                                callback(err);
                            });
                            return;
                        }

                        callback(null, hash, size);
                    });
                });
            });

            readStream.pipe(writeStream);

            //TODO this implementation should be moved to another class which inherits from writeablestream...
            readStream.on('data', function (chunk) {
                shasum.update(chunk);
                size += chunk.length; //TODO does it really have a length field always???
            });
        });
    };

    BlobFSBackend.prototype.getObject = function (hash, writeStream, bucket, callback) {
        var filename = path.join(this.blobDir, bucket, this._getObjectRelativeLocation(hash)),
            readStream = fs.createReadStream(filename);

        writeStream.on('finish', function () {
            // FIXME: any error handling here?
            fs.stat(filename, function(err, stat) {
                // FIXME: any error handling here?
                callback(null, {lastModified: stat.mtime.toISOString()});
            });
        });

        readStream.pipe(writeStream);
    };

    BlobFSBackend.prototype.listObjects = function (bucket, callback) {
        var self = this;
        var bucketName = path.join(self.blobDir, bucket);
        self._readDir(bucketName, function (err, found) {
            if (err) {
                callback(err);
                return;
            }

            var hashes = [];

            for (var i = 0; i < found.files.length; i += 1) {
                var f = found.files[i];
                var hash = f.name.slice(bucketName.length).replace(/(\/|\\)/g,'');
                hashes.push(hash);
            }

            callback(null, hashes);
        });
    };

    BlobFSBackend.prototype._getObjectRelativeLocation = function (hash) {
        return hash.slice(0, 2) + '/' + hash.slice(2);
    };

    BlobFSBackend.prototype._readDir = function(start, callback) {
        var self = this;
        // Use lstat to resolve symlink if we are passed a symlink
        fs.lstat(start, function(err, stat) {
            if(err) {
                return callback(err);
            }
            var found = {dirs: [], files: []},
                total = 0,
                processed = 0;
            function isDir(abspath) {
                fs.stat(abspath, function(err, stat) {
                    if(stat.isDirectory()) {
                        found.dirs.push(abspath);
                        // If we found a directory, recursion
                        self._readDir(abspath, function(err, data) {
                            found.dirs = found.dirs.concat(data.dirs);
                            found.files = found.files.concat(data.files);
                            if(++processed == total) {
                                callback(null, found);
                            }
                        });
                    } else {
                        found.files.push({name:abspath, mtime: stat.mtime});
                        if(++processed == total) {
                            callback(null, found);
                        }
                    }
                });
            }
            // Read through all the files in this directory
            if(stat.isDirectory()) {
                fs.readdir(start, function (err, files) {
                    total = files.length;
                    if (total === 0) {
                        callback(null, found);
                    }
                    for(var x=0, l=files.length; x<l; x++) {
                        isDir(path.join(start, files[x]));
                    }
                });
            } else {
                return callback(new Error("path: " + start + " is not a directory"));
            }
        });
    };

    return BlobFSBackend;
});