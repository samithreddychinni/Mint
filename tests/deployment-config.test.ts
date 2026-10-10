import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../next.config";

test("Vercel proxies all API paths before local handlers; Render keeps local handlers", async () => {
  const previous = process.env.BACKEND_URL;
  try {
    delete process.env.BACKEND_URL;
    assert.deepEqual(await config.rewrites!(), {
      beforeFiles: [],
      afterFiles: [],
      fallback: [],
    });
    process.env.BACKEND_URL = "https://mint-api.onrender.com/";
    assert.deepEqual(await config.rewrites!(), {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: "https://mint-api.onrender.com/api/:path*",
        },
      ],
      afterFiles: [],
      fallback: [],
    });
  } finally {
    if (previous === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = previous;
  }
});
