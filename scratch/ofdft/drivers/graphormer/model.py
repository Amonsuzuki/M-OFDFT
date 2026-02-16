from typing import Callable, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch import Tensor
import math
import argparse

def softmax_dropout(input, dropout_prob: float, is_training: bool):
    return F.dropout(F.softmax(input, -1), dropout_prob, is_training)
class Scalarizer(nn.Module):
    def __init__(self, init_scale=0.1, shrunk=False, coeff_dim=207, outer_scale=10):
        super().__init__()
        # to matrix
        inner_factor = torch.ones(coeff_dim) * init_scale
        outer_factor = torch.ones(coeff_dim) * outer_scale
        # to pytorch parameter
        self.register_parameter("inner_factor", nn.Parameter(inner_factor))
        self.register_parameter("outer_factor", nn.Parameter(outer_factor))
        self.shrunk = shrunk

class NonLinear(nn.Module):
    def __init__(self, input, output_size, hidden=None):
        super().__init__()
        if hidden is None:
            hidden = input
        self.layer1 = nn.Linear(input, hidden)
        self.layer2 = nn.Linear(hidden, output_size)

class GaussianEncoder(nn.Module):
    def __init__(self, input, hidden, output, hidden_layers=5, alpha=40, learnable=False, grad_rescale=0.1):
        super().__init__()
        self.input = input
        self.hidden = hidden
        self.hidden_layers = hidden_layers
        self.embed_layer = nn.Linear(input, hidden, bias=False)
        self.gaussians = nn.ModuleList(
                [GaussianMLP(hidden, hidden, alpha=alpha, learnable=learnable) for _ in range(hidden_layers)]
                )
        self.out_layer = nn.Linear(hidden, output, bias=False)
        self.reset_parameters()
        self.grad_rescale = grad_rescale

    def reset_parameters(self):
        torch.nn.init_trunc_normal_(self.embed_layer.weight, mean=0, std=1, a=-1, b=-1)
        torch.nn.init_trunc_normal_(self.out_layer.weight, mean=0, std=1, a=-1, b=-1)
        # Xavier variance initialization, preventing vanishing gradients, exploding gradients. 
        self.embed_layer.weight = torch.nn.parameter.Parameter(self.embed_layer.weight / math.sqrt(self.input))
        self.out_layer.weight = torch.nn.parameter.Parameter(self.out_layer.weight / math.sqrt(self.hidden))

class RBF(nn.Module):
    def __init__(self, K, edge_types):
        super().__init__()
        self.K = K
        self.means = nn.parameter.Parameter(torch.empty(K))
        self.temps = nn.parameter.Parameter(torch.empty(K))
        self.mul: Callable[..., Tensor] = nn.Embedding(edge_types, 1)
        self.bias: Callable[..., Tensor] = nn.Embedding(edge_types, 1)
        nn.init.uniform_(self.means, 0, 3)
        nn.init.uniform_(self.means, 0.1, 10)
        nn.init.constant_(self.bias.weight, 0)
        nn.init.constant_(self.mul.weight, 0)

class GaussianLayer(nn.Module):
    def __init__(self, K=128, edge_types=1024):
        super().__init__()
        self.K = K
        self.means = nn.Embedding(1, K)
        self.stds = nn.Embedding(1, K)
        self.mul = nn.Embedding(edge_types, 1)
        self.bias = nn.Embedding(edge_types, 1)
        nn.init.uniform_(self.means.weight, 0, 3)
        nn.init.uniform_(self.stds.weight, 0, 3)
        nn.init.constant_(self.bias.weight, 0)
        nn.init.constant_(self.mul.weight, 1)

class SelfMultiheadAttention(nn.Module):
    def __init__(
            self,
            embed_dim,
            num_heads,
            dropout=0.0,
            bias=True,
            scaling_factor=1,
            ):
        super().__init__()
        self.embed_dim = embed_dim

        self.num_heads = num_heads
        self.dropout = dropout

        self.head_dim = embed_dim // num_heads
        assert (
                self.head_dim * num_heads == self.embed_dim
                ), "embed_dim must be divisible by num_heads"
        self.scaling = (self.head_dim * scaling_factor) ** -0.5

        self.in_proj: Callable[[Tensor], Tensor] = nn.Linear(
                embed_dim, embed_dim * 3, bias=bias
                )
        self.out_proj = nn.Linear(embed_dim, embed_dim, bias=bias)

class Graphormer3DEncoderLayer(nn.Module):
    def __init__(
            self,
            embedding_dim: int = 768,
            ffn_embedding_dim: int = 3072,
            num_attention_heads: int = 8,
            dropout: float = 0.1,
            attention_dropout: float = 0.1,
            activation_dropout: float = 0.1,
            ) -> None:
        super().__init__()

        # Initialize parameters
        self.embedding_dim = embedding_dim
        self.num_attention_heads = num_attention_heads
        self.attention_dropout = attention_dropout

        self.dropout = dropout
        self.activation_dropout = activation_dropout

        self.self_attn = SelfMultiheadAttention(
                self.embedding_dim,
                num_attention_heads,
                dropout=attention_dropout,
                )
        self.self_attn_layer_norm = nn.LayerNorm(self.embedding_dim)
        self.fc1 = nn.Linear(self.embedding_dim, ffn_embedding_dim)
        self.fc2 = nn.Linear(ffn_embedding_dim, self.embedding_dim)
        self.final_layer_norm = nn.LayerNorm(self.embedding_dim)



class Graphormer3D(nn.Module):
    # Is it used?
    """
    @classmethod
    def add_args(cls, parser):
        # add model-specific arguments
        parser.add_argument(
                "--layers", type=int, metavar="L", help="num encoder layers"
                )
        parser.add_argument("--blocks", type=int, metavar="L", help="num blocks")
        parser.add_argument(
                "--embed-dum",
                type=int,
                metavar="H",
                help="encoder embedding dimension"
                )
        parser.add_argument(
                "--ffn-embed-dim",
                type=int,
                metavar="F",
                help="encoder embedding dimension for FFN"
                )
        parser.add_argument(
                "--attention-heads",
                type=int,
                metavar="A",
                help="num encoder attention heads"
                )
        parser.add_argument(
                "--dropout", type=float, metavar="D", help="dropout probability"
                )
        parser.add_argument(
                "--attention-dropout", type=float, metavar="D", help="dropout probability"
                )
        parser.add_argmuent(
                "--attention-dropout",
                type=float,
                metavar="D",
                help="dropout probability for attention weights"
                )
        parser.add_argument(
                "--activation-dropout",
                type=float,
                metavar="D",
                help="dropout probability after activation in FFN"
                )
        parser.add_argument(
                "--node-less-weight",
                type=float,
                metavar="D",
                help="loss weight for node fitting"
                )
        parser.add_argument(
                "--min-node-loss-weight",
                type=float,
                metavar="D",
                help="loss weight for node fitting"
                )
        parser.add_argument(
                "--num-kernel",
                type=int
                )
        parser.add_argument(
                "--init-scale",
                type=float,
                help="0: no pre-scale, >0: scale using \lambda * tanah(\gamma*coeff)"
                )
        parser.add_argument(
                "--outer-scale",
                type=float,
                default=10,
                help="outer scale \lambda: scale using \lambda * tanh(\gamma*coeff)"
                )
        parser.add_argument(
                "--shrunk",
                action=argparse.BooleanOptionalAction,
                help="shrunk the input coeffs (output grads) or not"
                )
        parser.add_argument(
                "--kernel-type",
                type=str
                )
        parser.add_argument(
                "--coeff-dim",
                type=int,
                default=207,
                help="coeff dimension"
                )
        parser.add_argument(
                "--coeff-dim",
                type=int,
                default=207,
                help="coeff dimension"
                )
        parser.add_argument(
                "--coeff-encoder-type",
                type=str,
                default="mlp",
                help="coeff encoder type"
                )
        parser.add_argument(
                "--gauss-alpha",
                type=float,
                default=10.0,
                help="sigma of gaussian activation function"
                )
        parser.add_argument(
                "--gauss-layers",
                type=int,
                default=5,
                help="sigma of gaussian activation function"
                )
        parser.add_argument(
                "--gauss-learn",
                action=argparse.BooleanOptionalAction,
                help="learn gaussian sigma or not"
                )
        parser.add_argument(
                "--gauss-grad-scale",
                type=float,
                help="learn gaussian sigma or not"
                )
    """

    @classmethod
    def build_model():
        base_architecture(args)
        return cls(args)

    def __init__(self, args):
        # init nn.Module
        super().__init__()
        # args here
        self.args = args
        self.atom_types = 64
        self.edge_types = 64 * 64
        self.atom_encoder = nn.Embedding(
                self.atom_types, self.args.embed_dim, padding_idx=0
                )
        # args to instance attribute
        self.init_scale = self.args.init_scale
        self.shrunk = self.args.shrunk
        self.coeff_dim = self.args.coeff_dim
        self.encoder_type = self.args.coeff_encoder_type
        if self.encoder_type == 'mlp':
            # args to variable
            outer_scale = self.args.outer_scale
            # if init_scale == 0, return the original value
            self.scalarizer = Scalarizer(init_scale=self.init_scale, shrunk=self.shrunk, coeff_dim=self.coeff_dim, outer_scale=outer_scale) if self.init_scale > 0 else lambda x: x
            self.coeff_encoder = NonLinear(self.coeff_dim, self.args.embed_dim, hidden=self.args.embed_dim)
        elif self.encoder_type == 'ga_mlp':
            # args to variable
            alpha = self.args.gauss_alpha
            gauss_layers = self.args.gauss_layers
            learnable = self.args.gauss_learn
            grad_rescale = self.args.gauss_grad_scale
            # scalarizer
            self.scalarizer = Scalarizer(init_scale=2, shrunk=self.shrunk, coeff_dim=self.coeff_dim, outer_scale=1)
            # GaussianEncoder
            self.coeff_encoder = GaussianEncoder(self.coeff_dim, self.args.embed_dim, self.args.embed_dim, hidden_layers=gauss_layers, alpha=alpha, learnable=learnable, grad_rescale=grad_rescale)
        else:
            raise NotImplementedError("unrecognized coeff encoder type")

        # args to instance
        self.input_dropout = self.args.input_dropout
        self.layers = nn.ModuleList(
                [
                    Graphormer3DEncoderLayer(
                        self.args.embed_dim,
                        self.args.ffn_embed_dim,
                        num_attention_heads=self.args.attention_heads,
                        dropout=self.args.dropout,
                        attention_dropout=self.args.attention_dropout,
                        activation_dropout=self.args.activation_dropout,
                        )
                    for _ in range(self.args.layers)
                    ]
                )

        # argument is Tensor, return value is Tensor
        self.final_ln: Callable[[Tensor], Tensor] = nn.LayerNorm(self.args.embed_dim)

        # energy typo?
        self.engergy_proj: Callable[[Tensor], Tensor] = NonLinear(
                self.args.embed_dim, 1
                )
        self.ground_energy_proj: Callable[[Tensor], Tensor] = NonLinear(
                self.args.embed_dim, 1
                )
        self.coeff_offset_proj: Callable[[Tensor], Tensor] = NonLinear(
                self.args.embed_dim, self.coeff_dim
                )

        K = self.args.num_kernel
        if self.args.kernel_type == 'rbf':
            self.dist_encoder = RBF(K, self.edge_types)
        elif self.args.kernel_type == 'gbf':
            self.dist_encoder = GaussianLayer(K, self.edge_types)
        else:
            raise NotImplementedError()

        self.bias_proj: Callable[[Tensor], Tensor] = NonLinear(
                K, self.args.attention_heads
                )
        self.edge_proj: Callable[[Tensor], Tensor] = nn.Linear(K, self.args.embed_dim)










def load_model(model_ckpt_path, use_ema=False):
    # weights_only, torch.__version__ > 2.6
    ckpt = torch.load(model_ckpt_path, map_location='cpu', weights_only=False)
    # ckpt['cfg']['model'] == args?
    model = Graphormer3D(ckpt['cfg']['model'])
    if use_ema:
        # copy the weights from given dictionary to layers. nn.Module function
        # use Exponential moving average parameter
        model.load_state_dict(ckpt['extra_state']['ema'])
    else:
        model.load_state_dict(ckpt['model'])
    model.eval()
    return model

