import { Capacitor } from '@capacitor/core';

/**
 * In-app purchases.
 *
 * On iOS this talks to Apple StoreKit through cordova-plugin-purchase
 * (works inside Capacitor). In a desktop/mobile browser it falls back to a
 * clearly-labelled TEST STORE so the whole purchase flow can be played
 * without an Apple account.
 *
 * Product IDs below must be created with the SAME IDs in App Store Connect
 * (My Apps → Last Haven → Monetization → In-App Purchases).
 */

export type ProductKind = 'consumable' | 'nonconsumable';

export interface ProductDef {
  id: string;
  kind: ProductKind;
  title: string;
  desc: string;
  icon: string;
  caps: number;
  fallbackPrice: string;
  badge?: string;
}

export const PRODUCTS: ProductDef[] = [
  {
    id: 'lasthaven.starter', kind: 'nonconsumable', icon: '🎒', caps: 300, fallbackPrice: '$2.99', badge: 'One-time',
    title: 'Survivor Starter Pack',
    desc: '300 Caps now, plus every run starts with +2 survivors, +1 armed guard and a golden HQ.',
  },
  {
    id: 'lasthaven.caps.small', kind: 'consumable', icon: '🧢', caps: 120, fallbackPrice: '$0.99',
    title: 'Pocket of Caps', desc: '120 Caps',
  },
  {
    id: 'lasthaven.caps.medium', kind: 'consumable', icon: '💰', caps: 650, fallbackPrice: '$4.99', badge: 'Popular',
    title: 'Sack of Caps', desc: '650 Caps (+8% bonus)',
  },
  {
    id: 'lasthaven.caps.large', kind: 'consumable', icon: '🏦', caps: 1400, fallbackPrice: '$9.99', badge: 'Best value',
    title: 'Vault of Caps', desc: '1,400 Caps (+17% bonus)',
  },
  {
    id: 'lasthaven.doubleloot', kind: 'nonconsumable', icon: '🗺️', caps: 0, fallbackPrice: '$3.99', badge: 'Permanent',
    title: "Scavenger's Map", desc: 'Permanently doubles everything your scavengers bring back from ruins.',
  },
];

export interface Store {
  readonly native: boolean;
  init(): Promise<void>;
  price(id: string): string;
  buy(id: string): Promise<void>;
  restore(): Promise<void>;
}

/** Called for every approved transaction; the receiver de-duplicates by transaction ID. */
export type GrantFn = (productId: string, transactionId: string) => void;

// ------------------------------------------------------------------ native (StoreKit)
class NativeStore implements Store {
  readonly native = true;
  constructor(private grant: GrantFn, private onChange: () => void) {}

  private get cdv(): any { return (window as any).CdvPurchase; }

  async init() {
    await new Promise<void>((resolve) => {
      if (this.cdv) return resolve();
      document.addEventListener('deviceready', () => resolve(), { once: true });
      setTimeout(resolve, 4000);
    });
    const C = this.cdv;
    if (!C) throw new Error('StoreKit plugin unavailable');
    const { store, ProductType, Platform, LogLevel } = C;
    store.verbosity = LogLevel.WARNING;
    store.register(
      PRODUCTS.map((p) => ({
        id: p.id,
        type: p.kind === 'consumable' ? ProductType.CONSUMABLE : ProductType.NON_CONSUMABLE,
        platform: Platform.APPLE_APPSTORE,
      })),
    );
    store
      .when()
      .approved((tx: any) => {
        // Deliver, then finish so Apple stops re-sending the transaction.
        // For production, add a server receipt validator (see docs/APP_STORE.md).
        for (const p of tx.products ?? []) this.grant(p.id, String(tx.transactionId));
        tx.finish();
      })
      .productUpdated(() => this.onChange());
    store.error((e: any) => console.warn('[store]', e?.code, e?.message));
    await store.initialize([Platform.APPLE_APPSTORE]);
  }

  price(id: string): string {
    const p = this.cdv?.store.get(id, this.cdv.Platform.APPLE_APPSTORE);
    return p?.pricing?.price ?? PRODUCTS.find((x) => x.id === id)?.fallbackPrice ?? '';
  }

  async buy(id: string) {
    const C = this.cdv;
    const offer = C.store.get(id, C.Platform.APPLE_APPSTORE)?.getOffer();
    if (!offer) throw new Error('This item is not available right now. Please try again later.');
    const err = await offer.order();
    if (err && err.code !== C.ErrorCode.PAYMENT_CANCELLED) throw new Error(err.message ?? 'Purchase failed');
  }

  async restore() {
    await this.cdv.store.restorePurchases();
  }
}

// ------------------------------------------------------------------ browser test store
class TestStore implements Store {
  readonly native = false;
  constructor(private grant: GrantFn, private confirmFn: (title: string, price: string) => Promise<boolean>) {}
  async init() {}
  price(id: string) { return PRODUCTS.find((p) => p.id === id)?.fallbackPrice ?? ''; }
  async buy(id: string) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) throw new Error('Unknown product');
    if (await this.confirmFn(p.title, p.fallbackPrice)) this.grant(id, `test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }
  async restore() {
    // nothing to restore in the test store — ownership is kept in the local profile
  }
}

export function createStore(grant: GrantFn, onChange: () => void, confirmFn: (title: string, price: string) => Promise<boolean>): Store {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios') return new NativeStore(grant, onChange);
  return new TestStore(grant, confirmFn);
}
