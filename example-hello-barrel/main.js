// Hello Barrel, demo plugin for the Barrel Plugin SDK.
// Uses only the BarrelPlugin global (frozen API). No direct invoke/webview access.

const api = window.BarrelPlugin;

api.registerTab({
  id: "hello",
  label: "Hello Barrel",
  render(container) {
    container.innerHTML = "";

    const heading = document.createElement("p");
    heading.textContent = "Welcome to the Barrel Plugin SDK!";
    container.appendChild(heading);

    const devicesBtn = api.ui.button({
      label: "List devices",
      variant: "accent",
    });
    container.appendChild(devicesBtn);

    const output = api.ui.outputPane();
    output.style.marginTop = "10px";
    container.appendChild(output);

    devicesBtn.addEventListener("click", async () => {
      output._clear();
      const serial = api.getDevice();
      output._append("Active device: " + (serial || "(none)"));
      try {
        const res = await api.execAdb(["devices", "-l"]);
        output._append(res.stdout);
      } catch (e) {
        output._append("Error: " + e);
      }
    });

    const countRow = document.createElement("div");
    countRow.style.display = "flex";
    countRow.style.alignItems = "center";
    countRow.style.gap = "10px";
    countRow.style.marginTop = "8px";
    const countBtn = api.ui.button({
      label: "Bump counter",
    });
    let count = parseInt(api.storage.get("count") || "0", 10);
    const label = api.ui.statusPill("count: " + count, "ok");
    countRow.appendChild(countBtn);
    countRow.appendChild(label);
    container.appendChild(countRow);
    countBtn.addEventListener("click", () => {
      count += 1;
      api.storage.set("count", String(count));
      label.textContent = "count: " + count;
    });
  },
});
