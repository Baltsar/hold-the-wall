// Creates the show's VM on Vultr, or finds it if it already exists. Needs VULTR_API_KEY.
//   node --env-file=.env scripts/vultr-vm.mjs plan     prints the plan and its price, creates nothing
//   node --env-file=.env scripts/vultr-vm.mjs create   creates it (once) and waits for its address
// The VM is labelled hold-the-wall; a second run finds it instead of making another.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const API = "https://api.vultr.com/v2";
const LABEL = "hold-the-wall";
const REGION = process.env.VULTR_REGION || "sto";
const PLAN = process.env.VULTR_PLAN || "vc2-2c-4gb";
const KEY_FILE = process.env.SSH_PUBLIC_KEY || path.join(homedir(), ".ssh", "id_ed25519.pub");

const key = process.env.VULTR_API_KEY;
if (!key) {
  console.error("VULTR_API_KEY is not set in .env");
  process.exit(1);
}

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function existing() {
  const { instances } = await api("GET", `/instances?label=${LABEL}`);
  return instances?.[0] ?? null;
}

async function planInfo() {
  const { plans } = await api("GET", "/plans?type=vc2&per_page=500");
  const plan = plans.find((p) => p.id === PLAN);
  if (!plan) throw new Error(`plan ${PLAN} not found`);
  if (!plan.locations.includes(REGION)) throw new Error(`plan ${PLAN} is not offered in ${REGION}`);
  const { os } = await api("GET", "/os?per_page=500");
  const ubuntu = os.find((o) => /Ubuntu 24\.04/.test(o.name) && o.arch === "x64");
  if (!ubuntu) throw new Error("Ubuntu 24.04 x64 not found");
  return { plan, ubuntu };
}

async function sshKeyId() {
  const pub = readFileSync(KEY_FILE, "utf8").trim();
  const { ssh_keys } = await api("GET", "/ssh-keys?per_page=500");
  const found = ssh_keys.find((k) => k.ssh_key.trim() === pub);
  if (found) return found.id;
  const { ssh_key } = await api("POST", "/ssh-keys", { name: LABEL, ssh_key: pub });
  return ssh_key.id;
}

const mode = process.argv[2] ?? "plan";
const found = await existing();
if (found) {
  console.log(`exists: ${found.id} ${found.main_ip} ${found.status}/${found.power_status} ${found.region} ${found.plan}`);
  process.exit(0);
}
const { plan, ubuntu } = await planInfo();
console.log(`plan: ${plan.id} in ${REGION}, ${plan.vcpu_count} vCPU, ${plan.ram} MB, $${plan.monthly_cost}/month, ${ubuntu.name}`);
if (mode !== "create") process.exit(0);

const sshkey_id = [await sshKeyId()];
const { instance } = await api("POST", "/instances", {
  region: REGION,
  plan: PLAN,
  os_id: ubuntu.id,
  label: LABEL,
  hostname: LABEL,
  sshkey_id,
  backups: "disabled",
  enable_ipv6: false,
  tags: [LABEL],
});
console.log(`created: ${instance.id}, waiting for it to come up`);
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const { instance: now } = await api("GET", `/instances/${instance.id}`);
  if (now.status === "active" && now.power_status === "running" && now.main_ip && now.main_ip !== "0.0.0.0") {
    console.log(`ready: ${now.id} ${now.main_ip}`);
    process.exit(0);
  }
}
console.error("the VM did not come up within 15 minutes; check the Vultr console");
process.exit(1);
