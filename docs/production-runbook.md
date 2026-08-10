# Fleet production runbook

This repository is split into two deployable pieces:

- `Dockerfile`: the Express/Firebase Admin API.
- `Dockerfile.frontend`: the Vite build served by Nginx.

Firebase remains the data/auth layer. AWS or Cloudflare hosts the application layers.

## 1. Secrets and GitHub

Never commit `.env`, Firebase Admin JSON, private keys, or payment secrets. The browser-safe `VITE_FIREBASE_*` values are configuration, not authorization; Firestore and Storage rules are the security boundary.

For local development:

1. Copy `.env.example` to `.env`.
2. Add the Firebase web configuration and backend credentials.
3. Keep `.env` ignored by Git.

For production, store these in AWS Secrets Manager (or an equivalent Cloudflare secret store):

- `FIREBASE_SERVICE_ACCOUNT_BASE64`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CORS_ORIGINS`

The frontend build needs these non-secret Vite variables as GitHub Actions environment variables or deployment-platform build variables:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY`
- `VITE_API_BASE_URL`

If a secret has ever been committed, rotate it at the provider first. Removing it from Git history does not invalidate the old credential.

## 2. Recommended AWS layout

1. Create an ECR repository for the API image.
2. Create an ECS Fargate cluster, private task subnet, security group, and an Application Load Balancer.
3. Register `deploy/ecs-task-definition.json` after replacing its placeholders.
4. Put the API behind HTTPS at a stable hostname such as `api.example.com`.
5. Point `CORS_ORIGINS` at the exact frontend origins, with no wildcard.
6. Create the GitHub Actions OIDC role and set the production environment variable `AWS_DEPLOY_ROLE_ARN` plus `AWS_REGION`, `ECR_REPOSITORY`, `ECS_CLUSTER`, and `ECS_SERVICE` repository variables.
7. Run the manual `Deploy API to ECS` workflow. It publishes an immutable image tagged with the commit SHA and waits for ECS stability.
8. Host the frontend in S3 + CloudFront, Cloudflare Pages, or the Nginx container on ECS. Set `VITE_API_BASE_URL` to the API hostname at build time.

The API task health check is `GET /api/health`. Configure the ALB health check to use the same endpoint and expose only HTTPS publicly.

## 3. Cloudflare alternative

Cloudflare Pages can build the Vite frontend from this repository. Cloudflare DNS/WAF can proxy the API hostname to the AWS ALB. Keep the API itself on ECS (or another private-capable container host) so Firebase Admin credentials never enter a browser build.

Use exact production origins in `CORS_ORIGINS`; do not use a wildcard when credentials are enabled.

## 4. Required release checks

Run locally or in CI:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:rules
node --check server.js
docker build --file Dockerfile --tag fleet-api:local .
```

The Firestore rules test requires Java because the Firebase emulator runs on the JVM. CI's Ubuntu runner provides that runtime; install Java locally if you want to run the emulator test on a workstation.

## 5. Pre-launch gates still requiring provider configuration

- Replace every placeholder in `deploy/ecs-task-definition.json`.
- Create the Firebase service account secret and least-privilege AWS roles.
- Configure Razorpay production keys and webhook verification. Client-side payment verification is guarded, but a production payment flow should reconcile through Razorpay webhooks and an idempotent event store.
- Put KYC assets behind private/authenticated Cloudinary delivery or private object storage. The upload signature protects the API secret and upload endpoint, but the current stored `secure_url` is still a delivery URL.
- Resolve high/critical runtime dependency audit findings before releasing. Review development-tool findings separately because the production API image installs only runtime dependencies.
- Replace the authenticated Firestore vehicle reads with a deliberately designed public vehicle projection if anonymous browsing is required.
