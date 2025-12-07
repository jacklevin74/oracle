"use strict";
/**
 * Pyth Network price feed client
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythClient = void 0;
const price_service_client_1 = require("@pythnetwork/price-service-client");
const events_1 = require("events");
const constants_1 = require("../config/constants");
/**
 * Normalize feed ID (remove 0x prefix and convert to lowercase)
 */
function normalizeFeedId(id) {
    return (id || '').toLowerCase().replace(/^0x/, '');
}
/**
 * Scale Pyth price to human-readable format
 */
function scalePythPrice(price) {
    if (!price || price.price === undefined || price.expo === undefined) {
        return null;
    }
    const n = typeof price.price === 'bigint' ? Number(price.price.toString()) : Number(price.price);
    if (!Number.isFinite(n)) {
        return null;
    }
    return n * Math.pow(10, price.expo);
}
/**
 * Pyth client for streaming price feeds
 */
class PythClient extends events_1.EventEmitter {
    constructor() {
        super();
        this.isSubscribed = false;
        this.priceService = new price_service_client_1.PriceServiceConnection(constants_1.PYTH_HERMES_URL, {
            priceFeedRequestConfig: { binary: true },
        });
        // Build feed ID mappings
        this.idBySymbol = new Map();
        this.symbolById = new Map();
        for (const [sym, id] of Object.entries(constants_1.PYTH_FEEDS)) {
            const normalizedId = normalizeFeedId(id);
            this.idBySymbol.set(sym, normalizedId);
            this.symbolById.set(normalizedId, sym);
        }
        this.priceIds = Array.from(this.idBySymbol.values());
    }
    /**
     * Get feed ID for a symbol
     */
    getFeedId(symbol) {
        return this.idBySymbol.get(symbol);
    }
    /**
     * Get symbol for a feed ID
     */
    getSymbol(feedId) {
        return this.symbolById.get(normalizeFeedId(feedId));
    }
    /**
     * Subscribe to price feed updates
     */
    subscribe() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isSubscribed) {
                return;
            }
            yield this.priceService.subscribePriceFeedUpdates(this.priceIds, (priceFeed) => {
                try {
                    const p = priceFeed.getPriceNoOlderThan(120);
                    if (!p) {
                        return;
                    }
                    const val = scalePythPrice(p);
                    if (val === null || !Number.isFinite(val)) {
                        return;
                    }
                    const id = normalizeFeedId(priceFeed.id);
                    const sym = this.symbolById.get(id);
                    if (!sym) {
                        return;
                    }
                    const pubMs = p.publishTime ? Number(p.publishTime) * 1000 : Date.now();
                    const priceData = { price: val, pubMs };
                    this.emit('price', sym, priceData);
                }
                catch (error) {
                    // Ignore stale price errors
                }
            });
            this.isSubscribed = true;
        });
    }
    /**
     * Close the price service connection
     */
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isSubscribed) {
                yield this.priceService.closeWebSocket();
                this.isSubscribed = false;
            }
        });
    }
    /**
     * Get available symbols
     */
    getAvailableSymbols() {
        return Array.from(this.idBySymbol.keys());
    }
}
exports.PythClient = PythClient;
