
import {BablicSDK, BablicOptions} from "./lib/sdk";
import {Middleware, ExtendedRequest, ExtendedResponse} from "./lib/common";
import {IncomingMessage, ServerResponse} from "http";

const createMiddleware = (options: BablicOptions): Middleware => {
    const middleware = new BablicSDK(options);
    return middleware.handle;
};

export {BablicSDK, BablicOptions} from "./lib/sdk";
export {Middleware, ExtendedRequest, ExtendedResponse} from "./lib/common";
export {setRenderServer} from "./lib/seo";
export const create = createMiddleware;

