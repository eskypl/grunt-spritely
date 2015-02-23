// Load in dependencies
var fs = require('fs');
var os = require('os');
var path = require('path');
var chalk = require('chalk');
var async = require('async');
var _ = require('underscore');
var json2css = require('json2css');
var spritesmith = require('spritesmith');
var url = require('url2');

// Define class to contain different extension handlers
function ExtFormat() {
	this.formatObj = {};
}
ExtFormat.prototype = {
	add: function (_name, _val) {
		this.formatObj[_name] = _val;
	},
	get: function (_filepath) {
		// Grab the extension from the filepath
		var ext = path.extname(_filepath);
		var lowerExt = ext.toLowerCase();

		// Look up the file extenion from our format object
		var formatObj = this.formatObj;
		return formatObj[lowerExt];
	}
};

// Create img and css formats
var imgFormats = new ExtFormat();
var cssFormats = new ExtFormat();

// Add our img formats
imgFormats.add('.png', 'png');
imgFormats.add('.jpg', 'jpeg');
imgFormats.add('.jpeg', 'jpeg');

// Add our css formats
cssFormats.add('.styl', 'stylus');
cssFormats.add('.stylus', 'stylus');
cssFormats.add('.sass', 'sass');
cssFormats.add('.scss', 'scss');
cssFormats.add('.less', 'less');
cssFormats.add('.json', 'json');
cssFormats.add('.css', 'css');

module.exports = function gruntSpritesmith (_grunt) {
	'use strict';

	// Create a SpriteMaker function
	function SpriteMaker() {
		// Grab the raw configuration
		var data = this.options({
			mapSrcToName: function(src) {
				var fullname = path.basename(src);
				var nameParts = fullname.split('.');

				// If there is are more than 2 parts, pop the last one
				if (nameParts.length >= 2) {
					nameParts.pop();
				}
				return nameParts.join('.');
			},
			mapDestImageToUrl: function(destImg) {
				return url.relative(data.destCSS, destImg);
			},
			cssVarMap: function noop () {}
		});

		// If we were invoked via `grunt-newer`, re-localize the info
		//if (data.src === undefined && data.files) {
		//	data = data.files[0] || {};
		//}

		// Determine the origin and destinations
		var destCss = data.destCSS;
		var cssTemplate = data.cssTemplate;
		var that = this;

		// Verify all properties are here
		if (this.files.length === 0) {
			return _grunt.fatal("grunt.spritely requires files.");
		}

		if (!destCss) {
			return _grunt.fatal('grunt.spritely requires a destCss property');
		}

		// Create an async callback
		var done = this.async();

		// A list of objects containing sprite coordinates.
		var cleanCoords = [];
		var spriteMaps = [];

		// Process one entry from "this.files".  Write the destination image file
		// and add items to cleanCoords.
		var processFilesEntry = function(_file, _fnCallBack) {
			if (!_file.dest || _file.src.length === 0) {
				_fnCallBack('grunt.spritely missing "dest" or "src".');
				return false;
			}

			// Determine the format of the image
			var imgOpts = data.imgOpts || {};
			var imgFormat = imgOpts.format || imgFormats.get(destImg) || 'png';

			// Set up the defautls for imgOpts
			_.defaults(imgOpts, {format: imgFormat});

			// Run through spritesmith
			var spritesmithParams = {
				src: _file.src,
				engine: data.engine || 'auto',
				algorithm: data.algorithm || 'top-down',
				padding: data.padding || 0,
				algorithmOpts: data.algorithmOpts || {},
				engineOpts: data.engineOpts || {},
				exportOpts: imgOpts
			};

			var destImg = _file.dest;
			//save path to sprite maps
			spriteMaps.push(destImg);

			spritesmith(spritesmithParams, function (_err, _result) {
				// If an error occurred, callback with it
				if (_err) {
					_grunt.fatal(_err);
					return done(_err);
				}

				// Otherwise, write out the result to destImg
				var destImgDir = path.dirname(destImg);
				_grunt.file.mkdir(destImgDir);
				fs.writeFileSync(destImg, _result.image, 'binary');

				// Generate a listing of CSS variables
				var coordinates = _result.coordinates;
				var properties = _result.properties;

				// Clean up the file name of the file
				Object.getOwnPropertyNames(coordinates).sort().forEach(function (_item) {
					// Extract the image name (exlcuding extension)
					var fullname = path.basename(_item);
					var nameParts = fullname.split('.');

					// If there is are more than 2 parts, pop the last one
					if (nameParts.length >= 2) {
						nameParts.pop();
					}

					// Extract out our name
					var coords = coordinates[_item];

					// Specify the image for the sprite
					coords.name = data.mapSrcToName(_item);
					coords.source_image = _item;
					// DEV: `image`, `total_width`, `total_height` are deprecated as they are overwritten in `spritesheet-templates`
					coords.image = data.mapDestImageToUrl(destImg);
					coords.total_width = properties.width;
					coords.total_height = properties.height;

					// Map the coordinates through cssVarMap
					coords = data.cssVarMap(coords) || coords;

					// Save the cleaned name and coordinates
					cleanCoords.push(coords);
				});

				_fnCallBack(null);
			});
		};

		async.eachLimit(this.files, os.cpus().length, processFilesEntry, function(_err) {
			if (_err) {
				_grunt.fatal(_err);
				return done(_err);
			}

			var cssFormat = 'spritesmith-custom';
			var cssOptions = data.cssOpts || {};

			// If there's a custom template, use it
			if (cssTemplate) {
				if (typeof cssTemplate === 'function') {
					json2css.addTemplate(cssFormat, cssTemplate);
				} else {
					json2css.addMustacheTemplate(cssFormat, fs.readFileSync(cssTemplate, 'utf8'));
				}
			} else {
				// Otherwise, override the cssFormat and fallback to 'json'
				cssFormat = data.cssFormat || cssFormats.get(destCss) || 'json';
			}

			// Set a flag that mustache templates can use to know if this is the last item.
			// This is useful when a template wants to emit comma-separated items.
			cleanCoords[cleanCoords.length-1].last = true;

			// Render the variables via `spritesheet-templates`
			var cssStr = json2css(cleanCoords, {'format': cssFormat, 'formatOpts': cssOptions});

			// Write it out to the CSS file
			var destCssDir = path.dirname(destCss);
			_grunt.file.mkdir(destCssDir);
			fs.writeFileSync(destCss, cssStr, 'utf8');

			// Fail task if errors were logged.
			if (that.errorCount) { done(false); }

			// Otherwise, print a success message.
			_grunt.log.writeln('Files "' + chalk.white.bgGreen(destCss) + '" and "' + chalk.white.bgGreen(spriteMaps.join(', ')) + '" ' + chalk.green('created') + '.');

			// Callback
			done(true);
		});
	}

	// Export the SpriteMaker function
	_grunt.registerMultiTask('spritely', 'Generate spritesheets', SpriteMaker);
};
