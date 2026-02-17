import pyscf
import pyscf.grad

def grad_nuc(mol):
    return pyscf.grad.rhf.grad_nuc(mol)
