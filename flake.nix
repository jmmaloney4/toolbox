{
  inputs = {
    ### Nixpkgs ###
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

    jackpkgs = {
      url = "github:jmmaloney4/jackpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flake-parts";
      inputs.systems.follows = "systems";
    };

    ### Flake / Project Inputs ###
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
    };

    systems.url = "github:nix-systems/default";
  };

  outputs = {
    self,
    nixpkgs,
    jackpkgs,
    flake-parts,
    systems,
  } @ inputs:
    flake-parts.lib.mkFlake {inherit inputs;} ({
      withSystem,
      inputs,
      ...
    }: {
      systems = import systems;
      imports = [
        jackpkgs.flakeModule
      ];

      jackpkgs.pulumi.enable = false;

      perSystem = {
        config,
        self',
        inputs',
        pkgs,
        system,
        lib,
        ...
      }: {
        checks = {
          test = pkgs.stdenv.mkDerivation {
            name = "sector7-tests";
            src = lib.cleanSource ./.;

            nativeBuildInputs = [
              pkgs.nodejs
              pkgs.pnpm_9
              pkgs.pnpmConfigHook
            ];

            pnpmDeps = pkgs.fetchPnpmDeps {
              pnpm = pkgs.pnpm_9;
              pname = "toolbox-deps";
              src = lib.cleanSource ./.;
              hash = "sha256-oiVz2/BQxdVPe2dkgK55q9bpHOvRtAgF0eIPMG/FLSg=";
              pnpmWorkspaces = ["@jmmaloney4/sector7"];
              fetcherVersion = 3;
            };

            pnpmWorkspaces = ["@jmmaloney4/sector7"];

            buildPhase = ''
              runHook preBuild
              pnpm --filter "@jmmaloney4/sector7" test
              runHook postBuild
            '';

            installPhase = ''
              touch $out
            '';
          };
        };

        devShells.default = pkgs.mkShell {
          inputsFrom = [
            config.jackpkgs.outputs.devShell
          ];
          buildInputs = with pkgs; [
            pnpm
            nodejs
          ];
        };
      };
    });
}
