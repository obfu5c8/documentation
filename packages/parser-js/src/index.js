/* @flow */

import type { DocumentationConfig, Comment } from 'documentation';

var _ = require('lodash'),
  t = require('babel-types'),
  util = require('util'),
  fs = require('fs'),
  parse = require('./parse'),
  walkComments = require('./extractors/comments'),
  walkExported = require('./extractors/exported'),
  debuglog = util.debuglog('documentation'),
  findTarget = require('./infer/finders').findTarget;

import { parseToAst } from './parse_to_ast';

/**
 * Left-pad a string so that it can be sorted lexicographically. We sort
 * comments to keep them in order.
 * @param {string} str the string
 * @param {number} width the width to pad to
 * @returns {string} a padded string with the correct width
 * @private
 */
function leftPad(str, width) {
  str = str.toString();
  while (str.length < width) {
    str = '0' + str;
  }
  return str;
}

/**
 * Receives a module-dep item,
 * reads the file, parses the JavaScript, and parses the JSDoc.
 *
 * @param {Object} data a chunk of data provided by module-deps
 * @param {Object} config config
 * @returns {Array<Object>} an array of parsed comments
 */
function parseJavaScript(data: Object, config: DocumentationConfig) {
  var visited = new Set();
  const commentsByNode = new Map();

  var ast = parseToAst(data.source);
  var addComment = _addComment.bind(null, visited, commentsByNode);

  return _.flatMap(
    config.documentExported
      ? [walkExported]
      : [
          walkComments.bind(null, 'leadingComments', true),
          walkComments.bind(null, 'innerComments', false),
          walkComments.bind(null, 'trailingComments', false)
        ],
    fn => fn(ast, data, addComment)
  ).filter(comment => comment && !comment.lends);
}

function _addComment(
  visited,
  commentsByNode,
  data,
  commentValue,
  commentLoc,
  path,
  nodeLoc,
  includeContext
) {
  // Avoid visiting the same comment twice as a leading
  // and trailing node
  var key =
    data.file + ':' + commentLoc.start.line + ':' + commentLoc.start.column;
  if (!visited.has(key)) {
    visited.add(key);

    var context /* : {
      loc: Object,
      file: string,
      sortKey: string,
      ast?: Object,
      code?: string
    }*/ = {
      loc: nodeLoc,
      file: data.file,
      sortKey: data.sortKey + ' ' + leftPad(nodeLoc.start.line, 8)
    };

    if (includeContext) {
      // This is non-enumerable so that it doesn't get stringified in
      // output; e.g. by the documentation binary.
      Object.defineProperty(context, 'ast', {
        configurable: true,
        enumerable: false,
        value: path
      });

      if (path.parentPath && path.parentPath.node) {
        var parentNode = path.parentPath.node;
        context.code = data.source.substring(parentNode.start, parentNode.end);
      }
    }
    const comment = parse(commentValue, commentLoc, context);
    if (includeContext) {
      commentsByNode.set((findTarget(path) || path).node, comment);

      if (t.isClassMethod(path) && path.node.kind === 'constructor') {
        // #689
        if (!comment.hideconstructor) {
          debuglog(
            'A constructor was documented explicitly: document along with the class instead'
          );
        }

        const parentComment = commentsByNode.get(
          path.parentPath.parentPath.node
        );
        if (parentComment) {
          parentComment.constructorComment = comment;
          return;
        }
        if (comment.hideconstructor) {
          return;
        }
      }
    }
    return comment;
  }
}

module.exports = function (sourceFile: {source: string, file: string}, config: DocumentationConfig) {
    if (!sourceFile.source) {
      sourceFile.source = fs.readFileSync(sourceFile.file, 'utf8');
    }
    return parseJavaScript(sourceFile, config);
}
