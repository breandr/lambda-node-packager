'use strict';
var fs = require('fs');
var childProcess = require('child_process');
var exec = childProcess.exec;
var execSync = childProcess.execSync;
const async = require('flowsync')
const temp = require('temp')
const fileSystem = require('fs-extra')
const path = require('path')
const archiver = require('archiver')
const glob = require('glob')
const aws = require('aws-sdk')

exports.handler = function(event, context) {
	context.exec = context.exec || exec
	context.npmPath = context.npmPath || `${__dirname}/node_modules/npm/bin/npm-cli.js`;
		let parameters = {};
	async.series([
			(done) => {
				console.log("Creating temporary directory");
				temp.mkdir("lambdaNodePackagerBuilder", (error, temporaryDirectoryPath) => {
					console.log(`Temporary directory created: ${temporaryDirectoryPath}`);
					parameters.temporaryDirectoryPath = temporaryDirectoryPath;
					done(error);
				});
			},
			(done) => {
				console.log(`Creating blank package.json file`);
				const temporaryDirectoryPath = parameters.temporaryDirectoryPath;
				const commands = [
					`cd ${temporaryDirectoryPath}`,
					`node ${context.npmPath} init -y`
				];
				context.exec(commands.join(";"), (initError) => {
					console.log(`Blank package.json file created.`);
					done(initError);
				});
			},
			(done) => {
				console.log(`Adding dependencies to package.json`);
				const temporaryDirectoryPath = parameters.temporaryDirectoryPath;
				const packageJsonFilePath = `${temporaryDirectoryPath}/package.json`;
				const packageJson = require(packageJsonFilePath);
				packageJson.description = "Temporary builder package.json for generation.";
				packageJson.repository = "https://this.doesntreallyexist.com/something.git";
				// packageJson.dependencies = { [event.package.name]: event.package.version };
				packageJson.dependencies = event.dependencies;
				fileSystem.writeFile(packageJsonFilePath, JSON.stringify(packageJson), (error) => {
					console.log(`Dependencies added to package.json`);
					done(error);
				});
			},
			(done) => {
				console.log(`Installing dependencies`);
				const temporaryDirectoryPath = parameters.temporaryDirectoryPath;
				const commands = [
					`cd ${temporaryDirectoryPath}`,
					`node ${context.npmPath} cache clean`,
					`node ${context.npmPath} install --production --no-bin-links --prefix ${temporaryDirectoryPath} --cache ${temporaryDirectoryPath} --init-module ${temporaryDirectoryPath}`
					// `npm install --production --no-bin-links --prefix ${temporaryDirectoryPath} --cache ${temporaryDirectoryPath} --init-module ${temporaryDirectoryPath}`
				];
				context.exec(commands.join(";"), (error, stdout) => {
					if(!error) console.log(`Dependencies installed: ${stdout}`);
					done(error);
				});
			},
			(done) => {
				const temporaryDirectoryPath = parameters.temporaryDirectoryPath;
				const packagesZip = archiver("zip", {});
				const nodeModulesGlob = `${temporaryDirectoryPath}/node_modules/**/*`;

				console.log(`Adding files to package zip: ${nodeModulesGlob}`);

				glob(nodeModulesGlob, { dot: true }, (error, filePaths) => {
					console.log(`Number of files found with glob: ${filePaths.length}`);
					filePaths.forEach((filePath) => {
						console.log(filePath)
						const isDirectory = fileSystem.statSync(filePath).isDirectory();
						if (!isDirectory) {
							const fileBuffer = fileSystem.readFileSync(filePath);

							//const fileReadStream = fileSystem.createReadStream(filePath);
							const relativeFilePath = path.relative(`${temporaryDirectoryPath}/node_modules/`, filePath).replace(temporaryDirectoryPath, "");
							console.log(`Adding "${filePath}" as "${relativeFilePath}"`);
							packagesZip.append(fileBuffer, { name: relativeFilePath } );
						}
					});
					console.log(`Done adding files to package zip.`);

					const zipFileWriteStream = fileSystem.createWriteStream(`${temporaryDirectoryPath}/package.zip`);

					zipFileWriteStream.on("close", () => {
						console.log(`Finished saving package zip`);
						done(null);
					});

					packagesZip.pipe(zipFileWriteStream);
					packagesZip.finalize();
				});
			},
			(done) => {
				if (event.region && event.bucket) {
					const temporaryDirectoryPath = parameters.temporaryDirectoryPath;
					const version = event.package.version;
					const s3 = new aws.S3({ region: event.region });

					const packageZipFilePath = `${temporaryDirectoryPath}/package.zip`;

					const packageZipReadBuffer = fileSystem.readFileSync(packageZipFilePath);

					const fileName = `${event.package.name}-${version}.zip`;

					parameters.fileName = fileName;

					console.log(`Saving package zip to S3 as: ${event.bucket}/${fileName}`);

					s3.putObject({
						Bucket: event.bucket,
						Key: fileName,
						Body: packageZipReadBuffer
					}, (error, response) => {
						console.log(response)
						console.log(`Finished saving package zip to S3 as: ${event.bucket}/${fileName}`);
						done(null, response);
					});
				} else {
					console.log(`Region or Bucket not set: ${event.region} - ${event.bucket}`);
					done();
				}
			},
			(done) => {
				if (event.localFilePath) {
					const temporaryDirectoryPath = parameters.temporaryDirectoryPath;
					const packageZipFilePath = `${temporaryDirectoryPath}/package.zip`;
					fileSystem.copy(packageZipFilePath, event.localFilePath, done);
				} else {
					console.log(`No local file path set.`);
					done();
				}
			}
		], (error) => {
			if (error) {
				console.log(`There was an error! ${error}`);
				context.fail(error);
			} else {
				console.log(`SUCCESS! ${parameters.fileName}`);
				context.succeed({
					fileName: parameters.fileName
				});
			}
		});
};
