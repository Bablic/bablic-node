"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("./lib/sdk");
const createMiddleware = (options) => {
    const middleware = new sdk_1.BablicSDK(options);
    return middleware.handle;
};
var sdk_2 = require("./lib/sdk");
exports.BablicSDK = sdk_2.BablicSDK;
var seo_1 = require("./lib/seo");
exports.setRenderServer = seo_1.setRenderServer;
exports.create = createMiddleware;
