const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../artifacts/pexo/node_modules/typescript");
const root = path.resolve(__dirname, "../artifacts/pexo/src");
const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("the initial application import graph does not load any wallet connector SDK", () => {
  const visited = new Set();
  const forbidden = /^(?:@reown\/|@tronweb3\/|@solana\/web3\.js|bitcoinjs-lib|sats-connect|tronweb|wagmi(?:\/|$)|viem\/chains)/;
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(!/\/lib\/(?:reown-config|evm-wallet-provider|extra-wallet-provider)\.tsx?$/.test(file),
      `Wallet runtime entered the initial import graph: ${file}`);
    const source = ts.createSourceFile(file, compile(file), ts.ScriptTarget.ESNext, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const dependency = statement.moduleSpecifier?.text;
      if (!dependency) continue;
      assert.ok(!forbidden.test(dependency), `${file} imports ${dependency} before a wallet is needed`);
      const local = dependency.startsWith("@/") ? path.join(root, dependency.slice(2))
        : dependency.startsWith(".") ? path.resolve(path.dirname(file), dependency) : null;
      if (!local) continue;
      const target = [local, `${local}.ts`, `${local}.tsx`, `${local}/index.ts`, `${local}/index.tsx`]
        .find(candidate => /\.tsx?$/.test(candidate) && fs.existsSync(candidate));
      if (target) visit(target);
    }
  }
  visit(path.join(root, "main.tsx"));
  assert.ok(visited.size > 10, "Followed the actual application, not just the entry file");
});

test("the initial HTML shows an accessible loader before JavaScript, respecting the artifact prefix", () => {
  const source = ts.transpileModule(fs.readFileSync(path.join(root, "lib/site-document.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports });
  const html = module.exports.createEntryDocument({ basePath: "/market/", development: true });
  assert.match(html, /href="\/market\/app-loading\.css"/);
  assert.match(html, /id="root"><div class="app-startup" role="status" aria-live="polite"/);
  assert.ok(html.indexOf("Loading your marketplace") < html.indexOf('src="/market/src/main.tsx"'));
});

test("wallet hooks, search, cart, and country availability wait until needed", () => {
  const header = fs.readFileSync(path.join(root, "components/app-header.tsx"), "utf8");
  const provider = fs.readFileSync(path.join(root, "lib/wallet-provider.tsx"), "utf8");
  const app = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
  assert.match(header, /enabled:\s*countryOpen/);
  assert.match(header, /const HeaderSearch = lazy\(/);
  assert.match(header, /const CartSheet = lazy\(/);
  assert.doesNotMatch(provider, /from ["']wagmi["']/);
  assert.match(provider, /import\(["']\.\/evm-wallet-provider["']\)/);
  assert.match(app, /const WalletToolsRouteProvider = lazy\(/);
  assert.match(app, /if \(!wallet\.ready\) return/);
});

test("Pexly icons come only from Hugeicons", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts/pexo/package.json"), "utf8"));
  for (const dependency of ["lucide-react", "react-icons"]) {
    assert.ok(!packageJson.dependencies?.[dependency] && !packageJson.devDependencies?.[dependency],
      `Unexpected icon package dependency: ${dependency}`);
  }
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        assert.doesNotMatch(fs.readFileSync(file, "utf8"), /lucide-react|react-icons\//,
          `Unexpected non-Hugeicons import in ${path.relative(root, file)}`);
      }
    }
  }
});

test("marketing CSS is split into the same lazy route bundles as its pages", () => {
  const pages = path.join(root, "pages/current-html");
  const globalCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const homepageCss = fs.readFileSync(path.join(pages, "page-styles/home.css"), "utf8");
  const aboutCss = fs.readFileSync(path.join(pages, "page-styles/about-us.css"), "utf8");

  assert.match(fs.readFileSync(path.join(pages, "home.tsx"), "utf8"), /page-styles\/home\.css/);
  assert.match(fs.readFileSync(path.join(pages, "about-us.tsx"), "utf8"), /page-styles\/about-us\.css/);
  assert.match(homepageCss, /\.v3-hero-banner/);
  assert.match(aboutCss, /\.section-about-hero/);
  assert.doesNotMatch(globalCss, /\.v3-hero-banner|\.section-about-hero/);
});
