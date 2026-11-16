const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// storefront.ts with @spacebar/util stubbed: the catalog it reads is the one category below
const category = {
    sku_id: "1555701506861178970",
    name: "Dead by Daylight",
    summary: " ",
    store_listing_id: "1555701506861178970",
    styles: { background_colors: [1, 2] },
    hero_ranking: ["1556811015948345355"],
    catalog_banner_url: "https://cdn.example/banner",
    pdp_bg_url: "https://cdn.example/pdp",
    hero_banner_display_config: { responsive: true },
    unpublished_at: "2027-01-01T00:00:00+00:00",
    products: [
        {
            sku_id: "1556799118427553842",
            name: "The Entity",
            summary: "Give your avatar a new look.",
            type: 0,
            premium_type: 2,
            hide_badge: true,
            prices: { 0: { country_prices: { country_code: "US", prices: [{ amount: 0, currency: "usd", exponent: 2 }] } } },
            items: [{ type: 0, sku_id: "1556799118427553842", asset: "a_2a8858b084e3ad989b46472107427d97" }],
        },
        {
            sku_id: "1556811015948345355",
            name: "The Entity Bundle",
            summary: "{joinedItems}",
            type: 1000,
            premium_type: 2,
            hide_badge: true,
            preview_assets: { fg_static: "https://cdn.example/fg" },
            items: [{ type: 0, sku_id: "1556799118427553842" }],
            bundled_products: [{ sku_id: "1556799118427553842", name: "The Entity", type: 0, items: [{ type: 0, sku_id: "1556799118427553842" }] }],
        },
        {
            sku_id: "1556801499403657236",
            name: "Dark Moon",
            type: 2000,
            items: [],
            variants: [
                {
                    sku_id: "1556801499403657236",
                    name: "Dark Moon (Base)",
                    type: 0,
                    variant_label: "Base",
                    variant_value: "#ffffff",
                    items: [{ type: 0, sku_id: "1556801499403657236" }],
                },
                {
                    sku_id: "1556801499403657237",
                    name: "Dark Moon (Red)",
                    type: 0,
                    variant_label: "Red",
                    variant_value: "#ff0000",
                    items: [{ type: 0, sku_id: "1556801499403657237" }],
                },
            ],
        },
    ],
};

// objects made inside the sandbox have its prototypes, so compare plain copies
const plain = (value) => JSON.parse(JSON.stringify(value));

function load() {
    const source = fs.readFileSync(path.join(__dirname, "../../src/api/util/utility/storefront.ts"), "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const util = {
        CollectibleItemType: { AVATAR_DECORATION: 0, PROFILE_EFFECT: 1, NAMEPLATE: 2, PROFILE_FRAME: 3, BUNDLE: 1000, VARIANTS_GROUP: 2000 },
        Snowflake: { timestampOf: (id) => Number(BigInt(id) >> 22n) + 1420070400000 },
        orbsExclusiveCategory: () => false,
        Collectibles: { categories: async () => [category, { sku_id: "1", name: "Empty", products: [] }] },
    };
    const module = { exports: {} };
    vm.runInNewContext(js, { module, exports: module.exports, require: (name) => (name === "@spacebar/util" ? util : require(name)) });
    return module.exports;
}

test("a catalog category becomes the storefront collection the shop's Browse tab reads", async () => {
    const { storefrontCollection, storefrontCategories } = load();
    assert.deepEqual(plain((await storefrontCategories()).map((x) => x.name)), ["Dead by Daylight"], "categories without products stay out");
    const collection = plain(storefrontCollection(category));
    assert.equal(collection.id, category.sku_id);
    assert.deepEqual(collection.product_ids, ["1556799118427553842", "1556811015948345355", "1556801499403657236"]);
    assert.deepEqual(collection.unpublish_settings, { will_unpublish_at: "2027-01-01T00:00:00+00:00" });
    assert.equal(collection.tenant_metadata.collectibles.catalog_banner_url, "https://cdn.example/banner");
    assert.deepEqual(collection.tenant_metadata.collectibles.hero_display_config, { responsive: true });
    assert.ok(!("products" in collection.tenant_metadata.collectibles) && !("sku_id" in collection.tenant_metadata.collectibles));
    assert.ok(!Number.isNaN(Date.parse(collection.created_at)));

    const [single, bundle, variants] = collection.products;
    assert.equal(single.skus[0].type, 2, "a single item is a durable SKU");
    assert.deepEqual(single.skus[0].tenant_metadata.collectibles.item, category.products[0].items[0]);
    assert.equal(single.tenant_metadata.collectibles.hide_badge, true, "the Nitro badge stays hidden on free items");
    assert.equal(single.tenant_metadata.collectibles.primary_collection_id, category.sku_id);

    assert.equal(bundle.skus[0].type, 4, "a bundle is a bundle SKU");
    assert.deepEqual(
        bundle.skus[0].bundled_skus.map((x) => x.tenant_metadata.collectibles.item.sku_id),
        ["1556799118427553842"],
    );
    assert.equal(bundle.skus[0].preview_asset_paths.fg_static, "https://cdn.example/fg");

    assert.deepEqual(variants.options, [{ name: "Dark Moon", option_values: ["Base", "Red"] }]);
    assert.deepEqual(variants.sku_ids, ["1556801499403657236", "1556801499403657237"]);
    assert.equal(variants.skus[1].selected_options[0].option_value, "Red");
    assert.equal(variants.skus[1].tenant_metadata.collectibles.option_selector_display_value, "#ff0000");

    assert.deepEqual(plain(storefrontCollection(category, false).products), [], "include_products=false leaves products out");
});
