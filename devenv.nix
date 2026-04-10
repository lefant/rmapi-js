{ pkgs, ... }:
let
  toolnix = builtins.getFlake "github:lefant/toolnix";
in {
  imports = [ toolnix.devenvModules.default ];
}
