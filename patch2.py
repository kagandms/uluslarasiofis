import sys

with open('app.js', 'r') as f:
    content = f.read()

old_func = """    function setActiveStep(stepNumber) {
        [step1, step2, step3].forEach((section, index) => {
            if (section) {
                section.classList.remove('active', 'hidden');
                if (index + 1 === stepNumber) {
                    section.classList.add('active');
                }
            }
        });

        [1, 2, 3].forEach(num => {
            const indicator = document.getElementById(`indicator-${num}`);
            if (indicator) {
                indicator.classList.remove('active', 'completed');
                if (num < stepNumber) indicator.classList.add('completed');
                if (num === stepNumber) indicator.classList.add('active');
            }
        });
    }"""

new_func = """    function setActiveStep(stepNumber) {
        [step1, stepPage2, step2, step3].forEach((section) => {
            if (section) section.classList.remove('active', 'hidden');
        });

        if (stepNumber === 1 && step1) step1.classList.add('active');
        if (stepNumber === 1.5 && stepPage2) stepPage2.classList.add('active');
        if (stepNumber === 2 && step2) step2.classList.add('active');
        if (stepNumber === 3 && step3) step3.classList.add('active');

        [1, 2, 3].forEach(num => {
            const indicator = document.getElementById(`indicator-${num}`);
            if (indicator) {
                indicator.classList.remove('active', 'completed');
                if (num < Math.floor(stepNumber)) indicator.classList.add('completed');
                if (num === Math.floor(stepNumber)) indicator.classList.add('active');
            }
        });
    }"""

content = content.replace(old_func, new_func)

with open('app.js', 'w') as f:
    f.write(content)
