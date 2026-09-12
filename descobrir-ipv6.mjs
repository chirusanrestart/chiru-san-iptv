const response = await fetch("https://api6.ipify.org");

if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
}

const ipv6 = (await response.text()).trim();

console.log("🌐 IPv6 público:");
console.log(ipv6);
