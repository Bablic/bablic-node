
import {BablicMiddleware, BablicOptions} from "./lib/sdk";
import {Middleware, ExtendedRequest, ExtendedResponse} from "./lib/common";
import {IncomingMessage, ServerResponse} from "http";

const BablicConstructor = (options: BablicOptions): Middleware => {
    const middleware = new BablicMiddleware(options);
    return (req: IncomingMessage , res: ServerResponse, next: () => void) => middleware.handle(req as ExtendedRequest, res as ExtendedResponse, next);
};

export {BablicMiddleware, BablicOptions} from "./lib/sdk";
export {Middleware, ExtendedRequest, ExtendedResponse} from "./lib/common";
export const create = BablicConstructor;

