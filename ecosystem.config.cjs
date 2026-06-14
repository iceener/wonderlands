module.exports = {
  apps: [
    {
      name: 'wonderlands-server',
      cwd: __dirname,
      script: 'npm',
      args: 'run start --workspace @wonderlands/server',
      interpreter: 'none',
      autorestart: true,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'wonderlands-client',
      cwd: __dirname,
      script: 'npm',
      args: 'run preview --workspace @wonderlands/client -- --host 0.0.0.0 --port 4173',
      interpreter: 'none',
      autorestart: true,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
