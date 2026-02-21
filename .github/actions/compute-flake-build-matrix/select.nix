system: outputs: let
  pick = name:
    if
      builtins.hasAttr name outputs
      && builtins.isAttrs (builtins.getAttr name outputs)
      && builtins.hasAttr system (builtins.getAttr name outputs)
    then (builtins.getAttr system (builtins.getAttr name outputs)) // {recurseForDerivations = true;}
    else {};
in {
  packages = pick "packages";
  checks = pick "checks";
}
