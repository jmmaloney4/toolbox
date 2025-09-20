# Test check for Jest tests
{pkgs}:
pkgs.stdenv.mkDerivation {
  name = "toolbox-tests";
  src = ../.;

  buildInputs = with pkgs; [
    nodejs_22
    nodePackages.pnpm
  ];

  buildPhase = ''
    export HOME=$TMPDIR
    export PNPM_HOME=$TMPDIR/.pnpm
    export PATH=$PNPM_HOME:$PATH

    # Install dependencies
    pnpm install --frozen-lockfile

    # Build packages
    pnpm build

    # Run tests
    pnpm test
  '';

  installPhase = ''
    mkdir -p $out
    echo "Tests passed" > $out/result
  '';
}
