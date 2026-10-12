pipeline {
    agent any

    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds()
    }

    environment {
        DOCKER_REGISTRY = 'registry.cn-shenzhen.aliyuncs.com'
        DOCKER_REPOSITORY = 'locals-wing/localsbnbai'
    }

    stages {
        stage('检出代码') {
            steps {
                checkout scm
                script {
                    // 兼容多分支流水线和普通 Git SCM 作业；沿用分支名标签。
                    def branch = env.BRANCH_NAME?.trim() ?: env.GIT_LOCAL_BRANCH?.trim()
                    if (!branch) {
                        branch = env.GIT_BRANCH?.trim()?.replaceFirst('^origin/', '')
                    }
                    if (!branch) {
                        error('无法确定 Git 分支，请配置多分支流水线或 Git SCM 分支。')
                    }
                    branch = branch.replaceFirst('^refs/heads/', '')
                    def imageTag = branch.replaceAll('/', '-')
                    if (!(imageTag ==~ /[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}/)) {
                        error('分支名无法生成有效 Docker 标签，请使用英文、数字、点、下划线或连字符。')
                    }
                    env.IMAGE_REF = "${env.DOCKER_REGISTRY}/${env.DOCKER_REPOSITORY}:${imageTag}"
                    echo "本次镜像：${env.IMAGE_REF}"
                }
            }
        }

        stage('构建镜像') {
            steps {
                // 远程 MCP 专用镜像；环境和凭证在部署时注入，不打包进镜像。
                sh '''
                    set -eu
                    docker build \
                      --file deployment/remote/Dockerfile \
                      --tag "$IMAGE_REF" .
                '''
            }
        }

        stage('推送镜像') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'aliyun-acr-cred',
                        usernameVariable: 'REGISTRY_USER',
                        passwordVariable: 'REGISTRY_PASS'
                    )
                ]) {
                    // 避免 Groovy 展开密码；临时登录配置不影响同节点其他作业。
                    sh '''
                        set +x
                        set -eu
                        registry_config_dir=$(mktemp -d)
                        trap 'rm -rf "$registry_config_dir"' EXIT
                        export DOCKER_CONFIG="$registry_config_dir"
                        printf '%s' "$REGISTRY_PASS" | docker login \
                          --username "$REGISTRY_USER" \
                          --password-stdin "$DOCKER_REGISTRY"
                        docker push "$IMAGE_REF"
                    '''
                }
                echo "镜像推送成功：${env.IMAGE_REF}"
            }
        }
    }
}
