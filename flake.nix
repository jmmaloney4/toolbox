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

      perSystem = {
        config,
        self',
        inputs',
        pkgs,
        system,
        lib,
        ...
      }: {
        devShells.default = pkgs.mkShell {
          inputsFrom = [
            config.jackpkgs.outputs.devShell
          ];
          buildInputs = with pkgs; [
          ];
        };
      };
    });
}