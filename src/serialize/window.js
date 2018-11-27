/* @flow */

import { isSameDomain, isWindowClosed, type CrossDomainWindowType, type DomainMatcher } from 'cross-domain-utils/src';
import { ZalgoPromise } from 'zalgo-promise/src';
import { uniqueID, memoizePromise } from 'belter/src';
import { serializeType, type CustomSerializedType } from 'universal-serialize/src';

import { SERIALIZATION_TYPE } from '../conf';
import { windowStore, globalStore } from '../global';
import { getWindowInstanceID } from '../lib';

let winToProxyWindow = windowStore('winToProxyWindow');
let idToProxyWindow = globalStore('idToProxyWindow');

function cleanupProxyWindows() {
    for (let id of idToProxyWindow.keys()) {
        // $FlowFixMe
        if (idToProxyWindow.get(id).shouldClean()) {
            idToProxyWindow.del(id);
        }
    }
}

type SerializedProxyWindow = {|
    close : () => ZalgoPromise<void>,
    focus : () => ZalgoPromise<void>,
    isClosed : () => ZalgoPromise<boolean>,
    setLocation : (string) => ZalgoPromise<void>,
    setName : (string) => ZalgoPromise<void>,
    id : string,
    getInstanceID : () => ZalgoPromise<string>
|};

export class ProxyWindow {

    serializedWindow : SerializedProxyWindow
    actualWindow : CrossDomainWindowType
    actualWindowPromise : ZalgoPromise<CrossDomainWindowType>

    constructor(serializedWindow : SerializedProxyWindow, actualWindow? : CrossDomainWindowType) {
        this.serializedWindow = serializedWindow;
        this.actualWindowPromise = new ZalgoPromise();
        if (actualWindow) {
            this.setWindow(actualWindow);
        }
        this.serializedWindow.getInstanceID = memoizePromise(this.serializedWindow.getInstanceID);
    }

    setLocation(href : string) : ZalgoPromise<ProxyWindow> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                this.actualWindow.location = href;
            } else {
                return this.serializedWindow.setLocation(href);
            }
        }).then(() => this);
    }

    setName(name : string) : ZalgoPromise<ProxyWindow> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                if (!isSameDomain(this.actualWindow)) {
                    throw new Error(`Can not set name for window on different domain`);
                }
                // $FlowFixMe
                this.actualWindow.name = name;
                // $FlowFixMe
                if (this.actualWindow.frameElement) {
                    // $FlowFixMe
                    this.actualWindow.frameElement.setAttribute('name', name);
                }
            } else {
                return this.serializedWindow.setName(name);
            }
        }).then(() => this);
    }

    close() : ZalgoPromise<ProxyWindow> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                this.actualWindow.close();
            } else {
                return this.serializedWindow.close();
            }
        }).then(() => this);
    }

    focus() : ZalgoPromise<ProxyWindow> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                this.actualWindow.focus();
            } else {
                return this.serializedWindow.focus();
            }
        }).then(() => this);
    }

    isClosed() : ZalgoPromise<boolean> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                return isWindowClosed(this.actualWindow);
            } else {
                return this.serializedWindow.isClosed();
            }
        });
    }

    setWindow(win : CrossDomainWindowType) {
        this.actualWindow = win;
        this.actualWindowPromise.resolve(win);
    }

    matchWindow(win : CrossDomainWindowType) : ZalgoPromise<boolean> {
        return ZalgoPromise.try(() => {
            if (this.actualWindow) {
                return win === this.actualWindow;
            }
            
            return ZalgoPromise.all([
                this.getInstanceID(),
                getWindowInstanceID(win)
            ]).then(([ proxyInstanceID, knownWindowInstanceID ]) => {
                let match = proxyInstanceID === knownWindowInstanceID;

                if (match) {
                    this.setWindow(win);
                }

                return match;
            });
        });
    }

    unwrap() : CrossDomainWindowType | ProxyWindow {
        return this.actualWindow || this;
    }

    awaitWindow() : ZalgoPromise<CrossDomainWindowType> {
        return this.actualWindowPromise;
    }

    getInstanceID() : ZalgoPromise<string> {
        if (this.actualWindow) {
            return getWindowInstanceID(this.actualWindow);
        } else {
            return this.serializedWindow.getInstanceID();
        }
    }

    serialize() : SerializedProxyWindow {
        return this.serializedWindow;
    }

    shouldClean() : boolean {
        return this.actualWindow && isWindowClosed(this.actualWindow);
    }

    static unwrap(win : CrossDomainWindowType | ProxyWindow) : CrossDomainWindowType | ProxyWindow {
        return ProxyWindow.isProxyWindow(win)
            // $FlowFixMe
            ? win.unwrap()
            : win;
    }

    static serialize(win : CrossDomainWindowType | ProxyWindow) : SerializedProxyWindow {
        cleanupProxyWindows();

        return ProxyWindow.toProxyWindow(win).serialize();
    }

    static deserialize(serializedWindow : SerializedProxyWindow) : ProxyWindow {
        cleanupProxyWindows();
        
        return idToProxyWindow.getOrSet(serializedWindow.id, () => {
            return new ProxyWindow(serializedWindow);
        });
    }

    static isProxyWindow(obj : mixed) : boolean {
        return obj instanceof ProxyWindow;
    }

    static toProxyWindow(win : CrossDomainWindowType | ProxyWindow) : ProxyWindow {
        cleanupProxyWindows();

        if (ProxyWindow.isProxyWindow(win)) {
            // $FlowFixMe
            return win;
        }

        // $FlowFixMe
        return winToProxyWindow.getOrSet(win, () => {
            let id = uniqueID();

            return idToProxyWindow.set(id, new ProxyWindow({
                id,
                getInstanceID: () => getWindowInstanceID(win),
                close:         () => ZalgoPromise.try(() => {
                    win.close();
                }),
                focus:         () => ZalgoPromise.try(() => {
                    win.focus();
                }),
                isClosed:      () => ZalgoPromise.try(() => {
                    // $FlowFixMe
                    return isWindowClosed(win);
                }),
                setLocation:   (href) => ZalgoPromise.try(() => {
                    // $FlowFixMe
                    if (isSameDomain(win)) {
                        try {
                            if (win.location && typeof win.location.replace === 'function') {
                                // $FlowFixMe
                                win.location.replace(href);
                                return;
                            }
                        } catch (err) {
                            // pass
                        }
                    }
    
                    // $FlowFixMe
                    win.location = href;
                }),
                setName:       (name) => ZalgoPromise.try(() => {
                    // $FlowFixMe
                    win.name = name;
                })
            // $FlowFixMe
            }, win));
        });
    }
}

export type SerializedWindow = CustomSerializedType<typeof SERIALIZATION_TYPE.CROSS_DOMAIN_WINDOW, SerializedProxyWindow>;

export function serializeWindow(destination : CrossDomainWindowType | ProxyWindow, domain : DomainMatcher, win : CrossDomainWindowType) : SerializedWindow {
    return serializeType(SERIALIZATION_TYPE.CROSS_DOMAIN_WINDOW, ProxyWindow.serialize(win));
}

export function deserializeWindow(source : CrossDomainWindowType, origin : string, win : SerializedProxyWindow) : ProxyWindow {
    return ProxyWindow.deserialize(win);
}