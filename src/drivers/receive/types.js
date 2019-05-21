/* @flow */

import { ZalgoPromise } from 'zalgo-promise/src';
import { isWindowClosed, matchDomain, stringifyDomainPattern, type CrossDomainWindowType } from 'cross-domain-utils/src';
import { noop } from 'belter/src';

import { MESSAGE_TYPE, MESSAGE_ACK, MESSAGE_NAME } from '../../conf';
import { sendMessage } from '../send';
import { getRequestListener, getResponseListener, deleteResponseListener, isResponseListenerErrored } from '../listeners';
import type { RequestMessage, AckResponseMessage, SuccessResponseMessage, ErrorResponseMessage } from '../types';
import type { OnType, SendType } from '../../types';

export const RECEIVE_MESSAGE_TYPES = {

    [ MESSAGE_TYPE.REQUEST ](source : CrossDomainWindowType, origin : string, message : RequestMessage, { on, send } : { on : OnType, send : SendType }) : ZalgoPromise<void> {

        const options = getRequestListener({ name: message.name, win: source, domain: origin });

        const logName = (message.name === MESSAGE_NAME.METHOD && message.data && typeof message.data.name === 'string') ? `${ message.data.name }()` : message.name;

        if (__DEBUG__) {
            // eslint-disable-next-line no-console
            console.info('receive::req', logName, origin, '\n\n', message.data);
        }

        function sendResponse(type : $Values<typeof MESSAGE_TYPE>, ack? : $Values<typeof MESSAGE_ACK>, response = {}) {

            if (message.fireAndForget || isWindowClosed(source)) {
                return;
            }

            if (__DEBUG__ && type !== MESSAGE_TYPE.ACK) {
                if (ack === MESSAGE_ACK.SUCCESS) {
                    // $FlowFixMe
                    console.info('respond::res', logName, origin, '\n\n', response.data);  // eslint-disable-line no-console
                } else if (ack === MESSAGE_ACK.ERROR) {
                    // $FlowFixMe
                    console.error('respond::err', logName, origin, '\n\n', response.error); // eslint-disable-line no-console
                }
            }

            // $FlowFixMe
            sendMessage(source, origin, {
                type,
                ack,
                hash:   message.hash,
                name:   message.name,
                ...response
            }, { on, send });
        }

        return ZalgoPromise.all([

            sendResponse(MESSAGE_TYPE.ACK),

            ZalgoPromise.try(() => {

                if (!options) {
                    // throw new Error(`No handler found for post message: ${ message.name } from ${ origin } in ${ window.location.protocol }//${ window.location.host }${ window.location.pathname }`);
                    // throw new Error('duplicate message handler skipped');

                    return new ZalgoPromise((resolve, reject) => {
                        if (!options) {
                            reject('no_handler');
                        }
                        else {
                            resolve();
                        }
                    });
                }

                if (!matchDomain(options.domain, origin)) {
                    throw new Error(`Request origin ${ origin } does not match domain ${ options.domain.toString() }`);
                }

                const data = message.data;

                return options.handler({ source, origin, data });

            }).then(data => {
                return sendResponse(MESSAGE_TYPE.RESPONSE, MESSAGE_ACK.SUCCESS, { data });
            }, error => {
                return sendResponse(MESSAGE_TYPE.RESPONSE, MESSAGE_ACK.ERROR, { error });
            })

        ]).then(noop).catch(err => {
            if (options && options.handleError) {
                return options.handleError(err);
            } else {
                throw err;
            }
        });
    },

    [ MESSAGE_TYPE.ACK ](source : CrossDomainWindowType, origin : string, message : AckResponseMessage) {

        if (isResponseListenerErrored(message.hash)) {
            return;
        }

        const options = getResponseListener(message.hash);

        if (!options) {
            return;
            // throw new Error(`No handler found for post message ack for message: ${ message.name } from ${ origin } in ${ window.location.protocol }//${ window.location.host }${ window.location.pathname }`);
        }

        if (!matchDomain(options.domain, origin)) {
            throw new Error(`Ack origin ${ origin } does not match domain ${ options.domain.toString() }`);
        }

        if (source !== options.win) {
            throw new Error(`Ack source does not match registered window`);
        }

        options.ack = true;
    },

    [ MESSAGE_TYPE.RESPONSE ](source : CrossDomainWindowType, origin : string, message : SuccessResponseMessage | ErrorResponseMessage) : void | ZalgoPromise<void> {

        if (isResponseListenerErrored(message.hash)) {
            return;
        }

        const options = getResponseListener(message.hash);

        if (!options) {
            return;
            // throw new Error(`No handler found for post message response for message: ${ message.name } from ${ origin } in ${ window.location.protocol }//${ window.location.host }${ window.location.pathname }`);
        }

        if (!matchDomain(options.domain, origin)) {
            throw new Error(`Response origin ${ origin } does not match domain ${ stringifyDomainPattern(options.domain) }`);
        }

        if (source !== options.win) {
            throw new Error(`Response source does not match registered window`);
        }

        deleteResponseListener(message.hash);

        const logName = (message.name === MESSAGE_NAME.METHOD && message.data && typeof message.data.name === 'string') ? `${ message.data.name }()` : message.name;

        if (message.ack === MESSAGE_ACK.ERROR) {
            if (__DEBUG__) {
                console.error('receive::err', logName, origin, '\n\n', message.error); // eslint-disable-line no-console
            }

            options.promise.reject(message.error);

        } else if (message.ack === MESSAGE_ACK.SUCCESS) {
            if (__DEBUG__) {
                console.info('receive::res', logName, origin, '\n\n', message.data); // eslint-disable-line no-console
            }

            options.promise.resolve({ source, origin, data: message.data });
        }
    }
};
