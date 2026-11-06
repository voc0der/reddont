FROM oven/bun:latest

# Copy application files (default WORKDIR in oven/bun is /home/bun/app)
ADD ./ ./

# Install the runtime dependencies only. Development packages such as pug-cli,
# and the typescript peer dependency, whose native compiler is a Go binary,
# never run in the image, and their advisories would ship in it anyway. So
# would the install cache's second copy of every package.
RUN bun install --production --omit=peer --frozen-lockfile && rm -rf /root/.bun/install/cache

# Create a directory for data
RUN mkdir -p /data

# Ensure /home/bun has proper permissions for traversal
RUN chmod 755 /home/bun

# Set default PUID and PGID
ENV PUID=1000
ENV PGID=1000

# The base image is rebuilt only now and then, so take Debian's security
# updates when this image is built: on 2026-11-05 its apt had a high advisory
# with a fix released. The entrypoint drops privileges with util-linux's
# setpriv, part of every Debian image, rather than gosu, a Go binary that only
# a Debian rebuild would move to a newer Go.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Add entrypoint script for handling dynamic PUID/PGID
ADD entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Keep working directory as /home/bun/app so bun can find modules
# The entrypoint will cd to /data if needed
WORKDIR /home/bun/app

# The entrypoint needs root only to create the PUID/PGID user and give it /data
# and the app, then runs the command as that user.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Privileges are dropped by the entrypoint before this command runs.
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["bun", "run", "src/index.js"]
